/**
 * Reads investments_seed_data/employer_stock_parsed_transactions.csv (produced by parse-employer-stock-to-csv.ts)
 * and writes into staging tables.
 *
 * Asset: Acme Corp, Inc. (ACME), investment_category_id=12 (Employer RSU),
 *   price_source='yahoo_finance', currency=USD.
 *
 * amount_inr: fetched from Frankfurter range API (one call for full date range).
 *   Weekend/holiday dates fall back to the nearest prior trading day's rate.
 *
 * Idempotency: Employer stock transactions are deleted by financial_institution_id=7 before re-inserting.
 *   Asset row is upserted (ON CONFLICT name DO UPDATE) — updates category_id from US Equity → Employer RSU.
 *
 * Run: cd backend && npx ts-node --project tsconfig.scripts.json scripts/seed-employer-stock.ts
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import Decimal from "decimal.js";

dotenv.config();

const CSV_PATH = path.join(
  __dirname,
  "../../investments_seed_data/employer_stock_parsed_transactions.csv",
);

const EMPLOYER_STOCK_FI_ID = 7;
const EMPLOYER_STOCK_RSU_CATEGORY_ID = 12;
const USD_CURRENCY_ID = 2;
// Employer identity comes from .env so the repository never names a real company.
const EMPLOYER_ASSET_NAME = process.env.EMPLOYER_STOCK_ASSET_NAME ?? "Acme Corp, Inc.";
const EMPLOYER_TICKER = process.env.EMPLOYER_STOCK_TICKER ?? "ACME";
const PRIMARY_PERSON_ID = 1;

// ─── CSV parsing ──────────────────────────────────────────────────────────────

interface CsvRow {
  type: "buy" | "sell";
  transacted_at: string;
  quantity: string;
  price_usd: string;
  amount_usd: string;
}

function parseCsv(filePath: string): CsvRow[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  const rows: CsvRow[] = [];
  // header: pdf_source,type,transacted_at,quantity,price_usd,amount_usd
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 6) continue;
    const type = parts[1].trim() as "buy" | "sell";
    if (type !== "buy" && type !== "sell") continue;
    rows.push({
      type,
      transacted_at: parts[2].trim(),
      quantity: parts[3].trim(),
      price_usd: parts[4].trim(),
      amount_usd: parts[5].trim(),
    });
  }
  return rows;
}

// ─── Frankfurter FX ───────────────────────────────────────────────────────────

interface FrankfurterRangeResponse {
  rates: Record<string, { INR: number }>;
}

async function fetchUsdInrRates(startDate: string, endDate: string): Promise<Map<string, Decimal>> {
  const url = `https://api.frankfurter.dev/v1/${startDate}..${endDate}?base=USD&symbols=INR`;
  console.log(`Fetching USD→INR rates: ${startDate} to ${endDate}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Frankfurter API error: ${res.status}`);
  const data = (await res.json()) as FrankfurterRangeResponse;
  const map = new Map<string, Decimal>();
  for (const [date, r] of Object.entries(data.rates)) {
    map.set(date, new Decimal(r.INR));
  }
  console.log(`Received rates for ${map.size} trading days`);
  return map;
}

// Falls back up to 7 calendar days for weekends/holidays.
function getRateForDate(date: string, ratesMap: Map<string, Decimal>): Decimal {
  if (ratesMap.has(date)) return ratesMap.get(date)!;
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  for (let i = 1; i <= 7; i++) {
    dt.setUTCDate(dt.getUTCDate() - 1);
    const prev = dt.toISOString().slice(0, 10);
    if (ratesMap.has(prev)) return ratesMap.get(prev)!;
  }
  throw new Error(`No USD→INR rate found within 7 days of ${date}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const rows = parseCsv(CSV_PATH);
  if (rows.length === 0) throw new Error(`No rows found in CSV: ${CSV_PATH}`);
  console.log(`Read ${rows.length} rows from CSV`);

  // Date range for Frankfurter — fetch before DB transaction
  const dates = rows.map((r) => r.transacted_at).sort();
  const usdInrRates = await fetchUsdInrRates(dates[0], dates[dates.length - 1]);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Upsert ACME — update category to Employer RSU if it exists as US Equity from IndMoney
    const assetResult = await client.query<{ id: number }>(
      `INSERT INTO asset_stage (name, investment_category_id, ticker_symbol, price_source, currency_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO UPDATE SET
         investment_category_id = EXCLUDED.investment_category_id,
         ticker_symbol          = EXCLUDED.ticker_symbol,
         price_source           = EXCLUDED.price_source,
         currency_id            = EXCLUDED.currency_id
       RETURNING id`,
      [
        EMPLOYER_ASSET_NAME,
        EMPLOYER_STOCK_RSU_CATEGORY_ID,
        EMPLOYER_TICKER,
        "yahoo_finance",
        USD_CURRENCY_ID,
      ],
    );
    const assetId = assetResult.rows[0].id;
    console.log(
      `Upserted ACME asset (id=${assetId}, investment_category_id=${EMPLOYER_STOCK_RSU_CATEGORY_ID})`,
    );

    // Delete existing Employer stock transactions (idempotency)
    const deleted = await client.query(
      `DELETE FROM investment_transaction_stage WHERE financial_institution_id = $1`,
      [EMPLOYER_STOCK_FI_ID],
    );
    console.log(
      `Deleted ${(deleted as unknown as { rowCount: number }).rowCount} existing Employer stock transactions`,
    );

    // Insert transactions
    let buyCount = 0;
    let sellCount = 0;

    for (const row of rows) {
      const qty = new Decimal(row.quantity);
      const price = new Decimal(row.price_usd);
      const amount = new Decimal(row.amount_usd);
      const rate = getRateForDate(row.transacted_at, usdInrRates);
      const amountInr = amount.mul(rate).toDecimalPlaces(4);

      await client.query(
        `INSERT INTO investment_transaction_stage
           (asset_id, person_id, financial_institution_id, type,
            quantity, price, amount, currency_id, transacted_at, amount_inr)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          assetId,
          PRIMARY_PERSON_ID,
          EMPLOYER_STOCK_FI_ID,
          row.type,
          qty.toFixed(8),
          price.toFixed(4),
          amount.toFixed(4),
          USD_CURRENCY_ID,
          row.transacted_at,
          amountInr.toFixed(4),
        ],
      );

      if (row.type === "buy") buyCount++;
      else sellCount++;
    }

    await client.query("COMMIT");

    console.log("\n--- Summary ---");
    console.log(`ACME asset id: ${assetId}`);
    console.log(`Buy transactions: ${buyCount}`);
    console.log(`Sell transactions: ${sellCount}`);
    console.log(`Total: ${buyCount + sellCount}`);
    console.log(
      "\nNext: run refresh-holding-stage-prices.ts to rebuild holding_stage and refresh prices.",
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed — rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  void run();
}
