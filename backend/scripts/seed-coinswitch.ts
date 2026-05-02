/**
 * Parses CoinSwitch XLSX (Spot Trades sheet only) and writes into staging tables.
 *
 * Sheet structure (0-indexed):
 *   Rows 0–15: metadata (skip)
 *   Row 16+:   data rows — Transaction Id, Date, Market, Price, Volume, Total, Trade Type, ...
 *
 * Amount is already INR-denominated: amount = amount_inr = Total column.
 *
 * Idempotency: CoinSwitch transactions are deleted by financial_institution_id before re-inserting.
 *   Asset rows are upserted (ON CONFLICT name DO UPDATE).
 *
 * Run: cd backend && npx ts-node --project tsconfig.scripts.json scripts/seed-coinswitch.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as XLSX from "xlsx";
import { Pool } from "pg";
import Decimal from "decimal.js";

dotenv.config();

const SEED_FILE = path.join(
  __dirname,
  "../../investments_seed_data/coinswitch_trades_seed_all_time_arjun.xlsx",
);

const SHEET_NAME = "Spot Trades";
const DATA_START_ROW = 16; // 0-indexed; rows 0–15 are metadata

const ASSET_MAP: Record<string, { name: string; ticker: string }> = {
  BTC: { name: "Bitcoin", ticker: "BTC-INR" },
  ETH: { name: "Ethereum", ticker: "ETH-INR" },
};

// "BTCINR" → "BTC", "ETHINR" → "ETH"
function parseBase(market: string): string {
  if (market.endsWith("INR")) return market.slice(0, -3);
  throw new Error(`Unexpected market format: ${market}`);
}

// "7,713,141.451869668620 INR" → Decimal
function parseInrString(raw: string | number): Decimal {
  if (typeof raw === "number") return new Decimal(raw);
  return new Decimal(raw.replace(/,/g, "").replace(" INR", "").trim());
}

// "2026-02-28 15:59:13" → "2026-02-28"
function parseDateStr(raw: string): string {
  return raw.slice(0, 10);
}

interface CoinSwitchRow {
  txId: string;
  date: string;
  base: string;
  price: Decimal;
  volume: Decimal;
  total: Decimal;
  tradeType: "buy" | "sell";
}

function parseXlsx(filePath: string): CoinSwitchRow[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) throw new Error(`Sheet "${SHEET_NAME}" not found in ${filePath}`);

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  const result: CoinSwitchRow[] = [];

  for (let i = DATA_START_ROW; i < rawRows.length; i++) {
    const row = rawRows[i] as (string | number)[];
    const txId = row[0] as string;
    const market = row[2] as string;
    const tradeTypeRaw = String(row[6]).toUpperCase();

    if (!txId || !market) continue;
    if (!["BUY", "SELL"].includes(tradeTypeRaw)) continue;

    const base = parseBase(market);
    if (!ASSET_MAP[base]) {
      console.warn(`  Row ${i}: unknown base asset "${base}" — skipping`);
      continue;
    }

    result.push({
      txId,
      date: parseDateStr(row[1] as string),
      base,
      price: parseInrString(row[3]),
      volume: new Decimal(String(row[4])),
      total: parseInrString(row[5]),
      tradeType: tradeTypeRaw === "BUY" ? "buy" : "sell",
    });
  }

  return result;
}

async function run(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const rows = parseXlsx(SEED_FILE);
    console.log(`Parsed ${rows.length} rows from "${SHEET_NAME}" sheet`);

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
    const personMap = new Map(persons.rows.map((r) => [r.name, r.id]));

    const cryptoId = catMap.get("Crypto");
    const inrCurrencyId = curMap.get("INR");
    const coinSwitchFinInstId = fiMap.get("CoinSwitch");
    const primaryId = personMap.get("Arjun");

    if (!cryptoId || !inrCurrencyId || !coinSwitchFinInstId || !primaryId) {
      throw new Error(
        `Missing ref IDs: Crypto=${cryptoId} INR=${inrCurrencyId} CoinSwitch=${coinSwitchFinInstId} Arjun=${primaryId}`,
      );
    }

    await client.query("BEGIN");

    // Upsert BTC and ETH assets
    const assetIdMap = new Map<string, number>();
    for (const [base, { name, ticker }] of Object.entries(ASSET_MAP)) {
      const { rows: assetRows } = await client.query<{ id: number }>(
        `INSERT INTO asset_stage (name, investment_category_id, ticker_symbol, price_source, currency_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (name) DO UPDATE SET
           investment_category_id = EXCLUDED.investment_category_id,
           ticker_symbol          = EXCLUDED.ticker_symbol,
           price_source           = EXCLUDED.price_source,
           currency_id            = EXCLUDED.currency_id
         RETURNING id`,
        [name, cryptoId, ticker, "coinmarketcap", inrCurrencyId],
      );
      assetIdMap.set(base, assetRows[0].id);
      console.log(`Upserted asset: ${name} (${ticker}) → asset_stage.id=${assetRows[0].id}`);
    }

    // Delete existing CoinSwitch transactions (idempotency)
    const deleted = await client.query(
      `DELETE FROM investment_transaction_stage WHERE financial_institution_id = $1`,
      [coinSwitchFinInstId],
    );
    console.log(
      `Deleted ${(deleted as unknown as { rowCount: number }).rowCount} existing CoinSwitch transactions`,
    );

    // Insert transactions
    let totalInserted = 0;
    for (const row of rows) {
      const assetId = assetIdMap.get(row.base)!;

      await client.query(
        `INSERT INTO investment_transaction_stage
           (asset_id, person_id, financial_institution_id, type,
            quantity, price, amount, currency_id, transacted_at, amount_inr)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          assetId,
          primaryId,
          coinSwitchFinInstId,
          row.tradeType,
          row.volume.toFixed(8),
          row.price.toFixed(4),
          row.total.toFixed(4),
          inrCurrencyId,
          row.date,
          row.total.toFixed(4), // already INR
        ],
      );
      totalInserted++;
    }

    await client.query("COMMIT");

    const btcRows = rows.filter((r) => r.base === "BTC");
    const ethRows = rows.filter((r) => r.base === "ETH");

    console.log(`\n--- Summary ---`);
    console.log(
      `BTC: ${btcRows.length} txns (${btcRows.filter((r) => r.tradeType === "buy").length} buys, ${btcRows.filter((r) => r.tradeType === "sell").length} sells)`,
    );
    console.log(
      `ETH: ${ethRows.length} txns (${ethRows.filter((r) => r.tradeType === "buy").length} buys, ${ethRows.filter((r) => r.tradeType === "sell").length} sells)`,
    );
    console.log(`Total inserted: ${totalInserted}`);
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
