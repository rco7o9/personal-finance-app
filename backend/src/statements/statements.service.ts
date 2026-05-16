import { HttpException, HttpStatus, Injectable, Inject } from "@nestjs/common";
import { Pool } from "pg";

export type StatementMetadata = {
  type: "investment" | "expense";
  platform: string;
  format: "csv" | "xlsx" | "pdf";
  personId: number;
};

export type PendingRow = {
  id: number;
  date: string;
  assetName: string;
  platform: string;
  categoryName: string;
  quantity: string | null;
  price: string | null;
  nativeCurrency: string | null;
  amountInr: string;
  status: string;
  confidenceScore: string | null;
  verificationStatus: string | null;
};

export type UploadResult = {
  inserted: number;
  skipped: number;
  verificationStatus: string;
  transactions: PendingRow[];
};

// Maps platformId → financial_institution.name (matches seed data in migration 001)
const PLATFORM_TO_FI: Record<string, string> = {
  zerodha: "Zerodha",
  indmoney: "INDMoney",
  coinswitch: "CoinSwitch",
  "paytm-money": "PayTM Money",
  "employer-stock": "Employer stock",
  "hdfc-bank": "HDFC Bank",
  "icici-bank": "ICICI Bank",
};

// Maps platformId → investment_category.name for investment platforms
const PLATFORM_TO_CATEGORY: Record<string, string> = {
  zerodha: "Indian Equity",
  indmoney: "US Equity",
  coinswitch: "Crypto",
  "paytm-money": "Indian Mutual Fund",
  "employer-stock": "Employer RSU",
};

// Maps platformId → native currency code
const PLATFORM_TO_CURRENCY: Record<string, string> = {
  indmoney: "USD",
  "employer-stock": "USD",
};

interface AgentTransaction {
  date: string;
  description: string;
  amount: number;
  type: "debit" | "credit";
  rowType: "expense" | "income" | "internal_transfer" | "investment" | "ignore";
  category?: string;
  assetName?: string;
  quantity?: number;
  price?: number;
  confidence: number;
  source_text: string;
}

interface AgentResponse {
  status: "ok" | "error";
  verificationStatus: "passed" | "failed" | "skipped";
  transactions: AgentTransaction[];
  error?: string;
}

@Injectable()
export class StatementsService {
  constructor(@Inject("DB_POOL") private readonly pool: Pool) {}

  async uploadStatement(file: Express.Multer.File, metadataJson: string): Promise<UploadResult> {
    let metadata: StatementMetadata;
    try {
      metadata = JSON.parse(metadataJson) as StatementMetadata;
    } catch {
      throw new HttpException("Invalid metadata JSON", HttpStatus.BAD_REQUEST);
    }

    const fiName = PLATFORM_TO_FI[metadata.platform];
    if (!fiName) {
      throw new HttpException(`Unknown platform: ${metadata.platform}`, HttpStatus.BAD_REQUEST);
    }

    // Call the agent service
    const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://localhost:3002";
    const apiKey = process.env.INTERNAL_API_KEY ?? "";

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([file.buffer as unknown as ArrayBuffer], { type: file.mimetype }),
      file.originalname,
    );
    formData.append("metadata", JSON.stringify({ ...metadata, filename: file.originalname }));

    let agentRes: AgentResponse;
    try {
      const res = await fetch(`${agentUrl}/parse`, {
        method: "POST",
        headers: { "X-Internal-API-Key": apiKey },
        body: formData,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Agent returned ${res.status}: ${body}`);
      }
      agentRes = (await res.json()) as AgentResponse;
    } catch (err) {
      throw new HttpException(
        `Agent call failed: ${(err as Error).message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    if (agentRes.status === "error") {
      throw new HttpException(
        `Agent error: ${agentRes.error ?? "unknown"}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    const relevant = agentRes.transactions.filter((t) => t.rowType === metadata.type);

    if (metadata.type === "investment") {
      return this.insertInvestmentTransactions(
        relevant,
        metadata,
        fiName,
        agentRes.verificationStatus,
      );
    } else {
      return this.insertExpenseTransactions(
        relevant,
        metadata,
        fiName,
        agentRes.verificationStatus,
      );
    }
  }

  private async insertInvestmentTransactions(
    transactions: AgentTransaction[],
    metadata: StatementMetadata,
    fiName: string,
    verificationStatus: string,
  ): Promise<UploadResult> {
    const client = await this.pool.connect();
    try {
      // Resolve FK IDs
      const fiRow = await client.query<{ id: number }>(
        "SELECT id FROM financial_institution WHERE name = $1",
        [fiName],
      );
      if (fiRow.rowCount === 0) {
        throw new HttpException(
          `Financial institution not found: ${fiName}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      const fiId = fiRow.rows[0].id;

      const categoryName = PLATFORM_TO_CATEGORY[metadata.platform] ?? "Indian Equity";
      const categoryRow = await client.query<{ id: number }>(
        "SELECT id FROM investment_category WHERE name = $1",
        [categoryName],
      );
      if (categoryRow.rowCount === 0) {
        throw new HttpException(
          `Investment category not found: ${categoryName}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      const categoryId = categoryRow.rows[0].id;

      const nativeCurrencyCode = PLATFORM_TO_CURRENCY[metadata.platform] ?? "INR";
      const currencyRow = await client.query<{ id: number }>(
        "SELECT id FROM currency WHERE code = $1",
        [nativeCurrencyCode],
      );
      if (currencyRow.rowCount === 0) {
        throw new HttpException(
          `Currency not found: ${nativeCurrencyCode}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      const currencyId = currencyRow.rows[0].id;

      // Fetch last 4 months for dedup
      const fourMonthsAgo = new Date();
      fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4);
      const dedupRows = await client.query<{
        transacted_at: string;
        amount: string;
        asset_name: string;
      }>(
        `SELECT it.transacted_at::text, it.amount::text, a.name AS asset_name
         FROM investment_transaction it
         JOIN asset a ON a.id = it.asset_id
         WHERE it.financial_institution_id = $1
           AND it.person_id = $2
           AND it.transacted_at >= $3`,
        [fiId, metadata.personId, fourMonthsAgo.toISOString().slice(0, 10)],
      );
      const existingKeys = new Set(
        dedupRows.rows.map(
          (r) => `${r.transacted_at.slice(0, 10)}|${r.amount}|${r.asset_name.toLowerCase()}`,
        ),
      );

      await client.query("BEGIN");

      let inserted = 0;
      let skipped = 0;
      const insertedIds: number[] = [];

      for (const txn of transactions) {
        const assetLabel = txn.assetName ?? txn.description;
        const amount = txn.amount;
        const dedupKey = `${txn.date}|${amount.toFixed(4)}|${assetLabel.toLowerCase()}`;

        if (existingKeys.has(dedupKey)) {
          skipped++;
          continue;
        }

        // Look up or create asset
        const assetSearch = await client.query<{ id: number }>(
          "SELECT id FROM asset WHERE lower(name) = lower($1) LIMIT 1",
          [assetLabel],
        );
        let assetId: number;
        if (assetSearch.rowCount && assetSearch.rowCount > 0) {
          assetId = assetSearch.rows[0].id;
        } else {
          const newAsset = await client.query<{ id: number }>(
            `INSERT INTO asset (name, investment_category_id, currency_id)
             VALUES ($1, $2, $3) RETURNING id`,
            [assetLabel, categoryId, currencyId],
          );
          assetId = newAsset.rows[0].id;
        }

        const txnType = txn.type === "debit" ? "buy" : "sell";
        const quantity = txn.quantity ?? 0;
        const price = txn.price ?? 0;

        const insertRow = await client.query<{ id: number }>(
          `INSERT INTO investment_transaction
             (asset_id, person_id, financial_institution_id, type, quantity, price,
              amount, amount_inr, native_currency, currency_id, transacted_at,
              status, source, confidence_score, verification_status, raw_source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                   'pending', 'imported', $12, $13, $14)
           RETURNING id`,
          [
            assetId,
            metadata.personId,
            fiId,
            txnType,
            quantity,
            price,
            amount,
            amount, // amount_inr = amount in MVP (no FX conversion)
            nativeCurrencyCode,
            currencyId,
            txn.date,
            txn.confidence,
            verificationStatus,
            JSON.stringify({ source_text: txn.source_text, parsed: txn }),
          ],
        );

        insertedIds.push(insertRow.rows[0].id);
        inserted++;
      }

      await client.query("COMMIT");

      // Fetch inserted rows for response
      const pendingRows =
        insertedIds.length > 0 ? await this.fetchPendingInvestmentRows(client, insertedIds) : [];

      return { inserted, skipped, verificationStatus, transactions: pendingRows };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        `Insert failed: ${(err as Error).message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      client.release();
    }
  }

  private async insertExpenseTransactions(
    transactions: AgentTransaction[],
    metadata: StatementMetadata,
    fiName: string,
    verificationStatus: string,
  ): Promise<UploadResult> {
    void fiName; // expense table has no financial_institution_id FK
    const client = await this.pool.connect();
    try {
      const inrRow = await client.query<{ id: number }>(
        "SELECT id FROM currency WHERE code = 'INR'",
      );
      const inrCurrencyId = inrRow.rows[0].id;

      // Dedup: last 4 months
      const fourMonthsAgo = new Date();
      fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4);
      const dedupRows = await client.query<{ date: string; amount: string; description: string }>(
        `SELECT date::text, amount::text, description
         FROM expense
         WHERE person_id = $1
           AND date >= $2`,
        [metadata.personId, fourMonthsAgo.toISOString().slice(0, 10)],
      );
      const existingKeys = new Set(
        dedupRows.rows.map(
          (r) => `${r.date.slice(0, 10)}|${r.amount}|${(r.description ?? "").toLowerCase()}`,
        ),
      );

      await client.query("BEGIN");

      let inserted = 0;
      let skipped = 0;
      const insertedIds: number[] = [];

      for (const txn of transactions) {
        const description = txn.description;
        const amount = txn.amount;
        const dedupKey = `${txn.date}|${amount.toFixed(4)}|${description.toLowerCase()}`;

        if (existingKeys.has(dedupKey)) {
          skipped++;
          continue;
        }

        // Look up or create expense category
        const catName = txn.category ?? "Uncategorised";
        const catSearch = await client.query<{ id: number }>(
          "SELECT id FROM expense_category WHERE lower(name) = lower($1) LIMIT 1",
          [catName],
        );
        let categoryId: number;
        if (catSearch.rowCount && catSearch.rowCount > 0) {
          categoryId = catSearch.rows[0].id;
        } else {
          const newCat = await client.query<{ id: number }>(
            "INSERT INTO expense_category (name) VALUES ($1) RETURNING id",
            [catName],
          );
          categoryId = newCat.rows[0].id;
        }

        const insertRow = await client.query<{ id: number }>(
          `INSERT INTO expense
             (person_id, category_id, amount, currency_id, date, description,
              status, confidence_score, verification_status, raw_source)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)
           RETURNING id`,
          [
            metadata.personId,
            categoryId,
            amount,
            inrCurrencyId,
            txn.date,
            description,
            txn.confidence,
            verificationStatus,
            JSON.stringify({ source_text: txn.source_text, parsed: txn }),
          ],
        );

        insertedIds.push(insertRow.rows[0].id);
        inserted++;
      }

      await client.query("COMMIT");

      const pendingRows =
        insertedIds.length > 0 ? await this.fetchPendingExpenseRows(client, insertedIds) : [];

      return { inserted, skipped, verificationStatus, transactions: pendingRows };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        `Insert failed: ${(err as Error).message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      client.release();
    }
  }

  async getPending(personId: number, type?: string): Promise<PendingRow[]> {
    if (!type || type === "investment") {
      const rows = await this.pool.query<PendingRow>(
        `SELECT
           it.id,
           it.transacted_at::text             AS date,
           a.name                             AS "assetName",
           fi.name                            AS platform,
           ic.name                            AS "categoryName",
           it.quantity::text                  AS quantity,
           it.price::text                     AS price,
           it.native_currency                 AS "nativeCurrency",
           COALESCE(it.amount_inr, it.amount)::text AS "amountInr",
           it.status::text                    AS status,
           it.confidence_score::text          AS "confidenceScore",
           it.verification_status             AS "verificationStatus"
         FROM investment_transaction it
         JOIN asset a ON a.id = it.asset_id
         JOIN investment_category ic ON ic.id = a.investment_category_id
         JOIN financial_institution fi ON fi.id = it.financial_institution_id
         WHERE it.person_id = $1
           AND it.status = 'pending'
           AND it.confidence_score IS NOT NULL
         ORDER BY it.transacted_at DESC`,
        [personId],
      );
      if (!type) {
        // also fetch expenses and merge
        const expRows = await this.getPendingExpenses(personId);
        return [...rows.rows, ...expRows];
      }
      return rows.rows;
    }
    return this.getPendingExpenses(personId);
  }

  private async getPendingExpenses(personId: number): Promise<PendingRow[]> {
    const rows = await this.pool.query<PendingRow>(
      `SELECT
         e.id,
         e.date::text                    AS date,
         e.description                   AS "assetName",
         'expense'                       AS platform,
         ec.name                         AS "categoryName",
         NULL                            AS quantity,
         NULL                            AS price,
         'INR'                           AS "nativeCurrency",
         e.amount::text                  AS "amountInr",
         e.status::text                  AS status,
         e.confidence_score::text        AS "confidenceScore",
         e.verification_status           AS "verificationStatus"
       FROM expense e
       JOIN expense_category ec ON ec.id = e.category_id
       WHERE e.person_id = $1
         AND e.status = 'pending'
         AND e.confidence_score IS NOT NULL
       ORDER BY e.date DESC`,
      [personId],
    );
    return rows.rows;
  }

  async reviewTransaction(
    id: number,
    action: "confirm" | "edit" | "reject",
    updates?: { assetName?: string; amountInr?: string },
  ): Promise<void> {
    if (action === "reject") {
      await this.deleteTransaction(id);
      return;
    }

    const newStatus = action === "edit" ? "edited" : "confirmed";

    if (action === "edit" && updates) {
      // Try investment_transaction first
      const invResult = await this.pool.query(
        `UPDATE investment_transaction
         SET status = $1::transaction_status,
             amount_inr = COALESCE($2::numeric, amount_inr),
             amount     = COALESCE($2::numeric, amount)
         WHERE id = $3 AND status = 'pending'`,
        [newStatus, updates.amountInr ?? null, id],
      );

      if ((invResult.rowCount ?? 0) === 0) {
        // Try expense
        await this.pool.query(
          `UPDATE expense
           SET status = $1::transaction_status,
               description = COALESCE($2, description),
               amount      = COALESCE($3::numeric, amount)
           WHERE id = $4 AND status = 'pending'`,
          [newStatus, updates.assetName ?? null, updates.amountInr ?? null, id],
        );
      }
    } else {
      // confirm — just flip status
      const invResult = await this.pool.query(
        `UPDATE investment_transaction
         SET status = $1::transaction_status
         WHERE id = $2 AND status = 'pending'`,
        [newStatus, id],
      );

      if ((invResult.rowCount ?? 0) === 0) {
        await this.pool.query(
          `UPDATE expense
           SET status = $1::transaction_status
           WHERE id = $2 AND status = 'pending'`,
          [newStatus, id],
        );
      }
    }
  }

  private async deleteTransaction(id: number): Promise<void> {
    const invResult = await this.pool.query(
      "DELETE FROM investment_transaction WHERE id = $1 AND status = 'pending'",
      [id],
    );
    if ((invResult.rowCount ?? 0) === 0) {
      await this.pool.query("DELETE FROM expense WHERE id = $1 AND status = 'pending'", [id]);
    }
  }

  private async fetchPendingInvestmentRows(
    client: import("pg").PoolClient,
    ids: number[],
  ): Promise<PendingRow[]> {
    const result = await client.query<PendingRow>(
      `SELECT
         it.id,
         it.transacted_at::text             AS date,
         a.name                             AS "assetName",
         fi.name                            AS platform,
         ic.name                            AS "categoryName",
         it.quantity::text                  AS quantity,
         it.price::text                     AS price,
         it.native_currency                 AS "nativeCurrency",
         COALESCE(it.amount_inr, it.amount)::text AS "amountInr",
         it.status::text                    AS status,
         it.confidence_score::text          AS "confidenceScore",
         it.verification_status             AS "verificationStatus"
       FROM investment_transaction it
       JOIN asset a ON a.id = it.asset_id
       JOIN investment_category ic ON ic.id = a.investment_category_id
       JOIN financial_institution fi ON fi.id = it.financial_institution_id
       WHERE it.id = ANY($1)
       ORDER BY it.transacted_at DESC`,
      [ids],
    );
    return result.rows;
  }

  private async fetchPendingExpenseRows(
    client: import("pg").PoolClient,
    ids: number[],
  ): Promise<PendingRow[]> {
    const result = await client.query<PendingRow>(
      `SELECT
         e.id,
         e.date::text                    AS date,
         e.description                   AS "assetName",
         'expense'                       AS platform,
         ec.name                         AS "categoryName",
         NULL                            AS quantity,
         NULL                            AS price,
         'INR'                           AS "nativeCurrency",
         e.amount::text                  AS "amountInr",
         e.status::text                  AS status,
         e.confidence_score::text        AS "confidenceScore",
         e.verification_status           AS "verificationStatus"
       FROM expense e
       JOIN expense_category ec ON ec.id = e.category_id
       WHERE e.id = ANY($1)
       ORDER BY e.date DESC`,
      [ids],
    );
    return result.rows;
  }
}
