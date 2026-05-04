/**
 * Parses IndMoney XLS files and writes into staging tables.
 *
 * Asset strategy:
 *   1. Copy all US Equity assets from production `asset` table → asset_stage (upsert on name).
 *   2. For any ticker found in the XLS not already in asset_stage, create a new asset_stage row.
 *
 * amount_inr: fetched from Frankfurter API (historical USD→INR rates) before the DB transaction.
 *   Weekend/holiday dates fall back to the nearest prior trading day's rate.
 *
 * Idempotency: INDMoney transactions are deleted by financial_institution_id before re-inserting.
 *   Asset rows are upserted (ON CONFLICT name DO UPDATE) — safe to re-run without wiping other platforms.
 *
 * Run: cd backend && npx ts-node --project tsconfig.scripts.json scripts/seed-indmoney.ts
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { Pool } from "pg";
import Decimal from "decimal.js";

dotenv.config();

const SEED_DIR = path.join(
  __dirname,
  "../../investments_seed_data/ind_money_trades_seed",
);

const FILES: Array<{ filename: string; person: string }> = [
  { filename: "ind_money_trades_seed_all_time_arjun.xls", person: "Arjun" },
  { filename: "ind_money_trades_seed_all_time_priya.xls", person: "Priya" },
];

const MONTH_MAP: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// "20 May 2022, 12:00 AM" → "2022-05-20"
// Avoids Date constructor to prevent IST→UTC day shift.
function parseDate(raw: string): string {
  const match = raw.match(/^(\d{1,2}) (\w{3}) (\d{4})/);
  if (!match) throw new Error(`Cannot parse date: ${raw}`);
  const month = MONTH_MAP[match[2]];
  if (!month) throw new Error(`Unknown month abbreviation: ${match[2]}`);
  return `${match[3]}-${month}-${match[1].padStart(2, "0")}`;
}

interface XlsRow {
  stockName: string;
  ticker: string;
  executionTime: string;
  transactionType: string;
  quantity: string;
  price: string;
  amount: string;
  txDate: string; // pre-parsed YYYY-MM-DD
}

function parseXls(filePath: string): XlsRow[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false });

  const data: XlsRow[] = [];
  for (let i = 11; i < rows.length; i++) {
    const row = rows[i] as string[];
    const ticker = row[1];
    const txType = row[5];
    if (!ticker || !txType || !["BUY", "SELL"].includes(txType.toUpperCase())) continue;

    const executionTime = row[3] ?? row[2];
    data.push({
      stockName: row[0],
      ticker: ticker.trim(),
      executionTime,
      transactionType: txType.toUpperCase(),
      quantity: row[7],
      price: row[8],
      amount: row[9],
      txDate: parseDate(executionTime),
    });
  }
  return data;
}

interface FrankfurterRangeResponse {
  rates: Record<string, { INR: number }>;
}

async function fetchUsdInrRates(
  startDate: string,
  endDate: string,
): Promise<Map<string, Decimal>> {
  const url = `https://api.frankfurter.dev/v1/${startDate}..${endDate}?base=USD&symbols=INR`;
  console.log(`Fetching USD→INR rates from Frankfurter: ${startDate} to ${endDate}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Frankfurter API error: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as FrankfurterRangeResponse;

  const ratesMap = new Map<string, Decimal>();
  for (const [date, r] of Object.entries(data.rates)) {
    ratesMap.set(date, new Decimal(r.INR));
  }
  console.log(`Received rates for ${ratesMap.size} trading days`);
  return ratesMap;
}

// Returns the USD→INR rate for the given date, falling back to the nearest prior trading day.
function getRateForDate(date: string, ratesMap: Map<string, Decimal>): Decimal {
  if (ratesMap.has(date)) return ratesMap.get(date)!;
  // Walk backwards up to 7 calendar days (covers weekends + holidays)
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  for (let i = 1; i <= 7; i++) {
    dt.setUTCDate(dt.getUTCDate() - 1);
    const prev = dt.toISOString().slice(0, 10);
    if (ratesMap.has(prev)) return ratesMap.get(prev)!;
  }
  throw new Error(`No USD→INR rate found within 7 days of ${date}`);
}

type RefIds = {
  usEquityId: number;
  usdCurrencyId: number;
  indmoneyFinInstId: number;
  personIdMap: Map<string, number>;
};

async function loadRefIds(
  client: { query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }> },
): Promise<RefIds> {
  const cats = await client.query<{ id: number; name: string }>(
    "SELECT id, name FROM investment_category",
  );
  const catMap = new Map(cats.rows.map((r) => [r.name, r.id]));

  const curs = await client.query<{ id: number; code: string }>(
    "SELECT id, code FROM currency",
  );
  const curMap = new Map(curs.rows.map((r) => [r.code, r.id]));

  const fis = await client.query<{ id: number; name: string }>(
    "SELECT id, name FROM financial_institution",
  );
  const fiMap = new Map(fis.rows.map((r) => [r.name, r.id]));

  const persons = await client.query<{ id: number; name: string }>(
    "SELECT id, name FROM person",
  );
  const personIdMap = new Map(persons.rows.map((r) => [r.name, r.id]));

  const usEquityId = catMap.get("US Equity");
  const usdCurrencyId = curMap.get("USD");
  const indmoneyFinInstId = fiMap.get("INDMoney");

  if (!usEquityId || !usdCurrencyId || !indmoneyFinInstId) {
    throw new Error(
      `Missing ref IDs: usEquity=${usEquityId} USD=${usdCurrencyId} INDMoney=${indmoneyFinInstId}`,
    );
  }

  return { usEquityId, usdCurrencyId, indmoneyFinInstId, personIdMap };
}

async function run(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // Step 1: Parse all XLS files upfront to collect rows and date range
    const allFileRows: Array<{ rows: XlsRow[]; person: string; filename: string }> = [];
    let minDate = "9999-12-31";
    let maxDate = "0000-01-01";

    for (const { filename, person } of FILES) {
      const filePath = path.join(SEED_DIR, filename);
      if (!fs.existsSync(filePath)) {
        console.warn(`File not found, skipping: ${filename}`);
        continue;
      }
      const rows = parseXls(filePath);
      console.log(`Parsed ${person} (${filename}): ${rows.length} rows`);
      for (const r of rows) {
        if (r.txDate < minDate) minDate = r.txDate;
        if (r.txDate > maxDate) maxDate = r.txDate;
      }
      allFileRows.push({ rows, person, filename });
    }

    // Step 2: Fetch historical USD→INR rates before opening DB transaction
    const usdInrRates = await fetchUsdInrRates(minDate, maxDate);

    const refs = await loadRefIds(client);

    await client.query("BEGIN");

    // Step 3: Copy all production US Equity assets → asset_stage (upsert)
    const copied = await client.query<{ id: number }>(
      `INSERT INTO asset_stage (name, investment_category_id, ticker_symbol, price_source, currency_id)
       SELECT a.name, a.investment_category_id, a.ticker_symbol, a.price_source, a.currency_id
       FROM asset a
       JOIN investment_category ic ON a.investment_category_id = ic.id
       WHERE ic.name = 'US Equity'
       ON CONFLICT (name) DO UPDATE SET
         investment_category_id = EXCLUDED.investment_category_id,
         ticker_symbol          = EXCLUDED.ticker_symbol,
         price_source           = EXCLUDED.price_source,
         currency_id            = EXCLUDED.currency_id
       RETURNING id`,
    );
    console.log(`Copied/updated ${copied.rows.length} US Equity assets from production → asset_stage`);

    // Step 4: Delete existing INDMoney transactions (idempotency)
    const deleted = await client.query(
      `DELETE FROM investment_transaction_stage WHERE financial_institution_id = $1`,
      [refs.indmoneyFinInstId],
    );
    console.log(`Deleted ${(deleted as unknown as { rowCount: number }).rowCount} existing INDMoney transactions`);

    // Build ticker → asset_stage id map
    const stageAssets = await client.query<{ id: number; ticker_symbol: string }>(
      `SELECT id, ticker_symbol FROM asset_stage WHERE ticker_symbol IS NOT NULL`,
    );
    const tickerToStageId = new Map(stageAssets.rows.map((r) => [r.ticker_symbol, r.id]));

    // Step 5: Insert transactions with amount_inr computed from historical rates
    let totalTxns = 0;
    let newAssets = 0;

    for (const { rows, person, filename } of allFileRows) {
      const personId = refs.personIdMap.get(person);
      if (!personId) throw new Error(`Person not found: ${person}`);

      console.log(`\nInserting ${person} (${filename}): ${rows.length} rows`);

      for (const row of rows) {
        if (!tickerToStageId.has(row.ticker)) {
          const inserted = await client.query<{ id: number }>(
            `INSERT INTO asset_stage (name, investment_category_id, ticker_symbol, price_source, currency_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (name) DO UPDATE SET
               ticker_symbol = EXCLUDED.ticker_symbol
             RETURNING id`,
            [
              row.stockName,
              refs.usEquityId,
              row.ticker,
              "yahoo_finance",
              refs.usdCurrencyId,
            ],
          );
          tickerToStageId.set(row.ticker, inserted.rows[0].id);
          newAssets++;
          console.log(`  New asset: ${row.ticker} — ${row.stockName}`);
        }

        const assetId = tickerToStageId.get(row.ticker)!;
        const qty = new Decimal(row.quantity);
        const price = new Decimal(row.price);
        const amount = new Decimal(row.amount);
        const txType = row.transactionType === "BUY" ? "buy" : "sell";
        const rate = getRateForDate(row.txDate, usdInrRates);
        const amountInr = amount.mul(rate).toDecimalPlaces(4);

        await client.query(
          `INSERT INTO investment_transaction_stage
             (asset_id, person_id, financial_institution_id, type,
              quantity, price, amount, currency_id, transacted_at, amount_inr)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            assetId,
            personId,
            refs.indmoneyFinInstId,
            txType,
            qty.toFixed(8),
            price.toFixed(4),
            amount.toFixed(4),
            refs.usdCurrencyId,
            row.txDate,
            amountInr.toFixed(4),
          ],
        );
        totalTxns++;
      }
    }

    await client.query("COMMIT");

    console.log(`\n--- Summary ---`);
    console.log(`New assets created in asset_stage: ${newAssets}`);
    console.log(`Total transactions inserted: ${totalTxns}`);
    console.log("Done.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed — rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

void run();
