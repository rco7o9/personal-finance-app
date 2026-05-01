/**
 * Parses all Zerodha FY CSV files and writes into staging tables.
 * Aggregates partial fills by order_id: sum(qty), weighted-avg price, earliest execution date.
 * Fetches real company names from Yahoo Finance for each unique ticker (falls back to symbol).
 *
 * Idempotency: staging tables have no platform column — to re-run from scratch, TRUNCATE
 * asset_stage and investment_transaction_stage first (in CloudBeaver or via psql).
 * asset_stage uses ON CONFLICT (name) DO UPDATE so re-inserting the same asset is safe.
 *
 * Run: cd backend && npx ts-node --project tsconfig.scripts.json scripts/seed-zerodha.ts
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import { Pool } from "pg";
import Decimal from "decimal.js";

dotenv.config();

const GOLD_ETF_ISIN = "INF846K01W80";
const SEED_DIR = path.join(
  __dirname,
  "../../investments_seed_data/zerodha_trades_seed",
);

interface CsvRow {
  symbol: string;
  isin: string;
  trade_date: string;
  exchange: string;
  segment: string;
  series: string;
  trade_type: string;
  auction: string;
  quantity: string;
  price: string;
  trade_id: string;
  order_id: string;
  order_execution_time: string;
}

type RefIds = {
  indianEquityId: number;
  goldId: number;
  inrCurrencyId: number;
  zerodhFinInstId: number;
  primaryPersonId: number;
};

async function loadRefIds(client: {
  query: (sql: string) => Promise<{ rows: { id: number; name: string; code?: string }[] }>;
}): Promise<RefIds> {
  const cats = await client.query("SELECT id, name FROM investment_category");
  const catMap = new Map(cats.rows.map((r) => [r.name, r.id]));

  const cur = await client.query("SELECT id, code FROM currency");
  const curMap = new Map(cur.rows.map((r) => [r.code!, r.id]));

  const fi = await client.query("SELECT id, name FROM financial_institution");
  const fiMap = new Map(fi.rows.map((r) => [r.name, r.id]));

  const pe = await client.query("SELECT id, name FROM person");
  const peMap = new Map(pe.rows.map((r) => [r.name, r.id]));

  const indianEquityId = catMap.get("Indian Equity");
  const goldId = catMap.get("Gold ETF") ?? catMap.get("Gold");
  const inrCurrencyId = curMap.get("INR");
  const zerodhFinInstId = fiMap.get("Zerodha");
  const primaryPersonId = peMap.get("Arjun");

  if (!indianEquityId || !goldId || !inrCurrencyId || !zerodhFinInstId || !primaryPersonId) {
    throw new Error(
      `Missing reference IDs: indianEquity=${indianEquityId} gold=${goldId} INR=${inrCurrencyId} Zerodha=${zerodhFinInstId} Arjun=${primaryPersonId}`,
    );
  }
  return { indianEquityId, goldId, inrCurrencyId, zerodhFinInstId, primaryPersonId };
}

interface YFSearchResult {
  quotes?: Array<{ symbol?: string; longname?: string; shortname?: string }>;
}

async function fetchCompanyName(ticker: string, fallback: string): Promise<string> {
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&quotesCount=3&newsCount=0&enableFuzzyQuery=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as YFSearchResult;
    const quote = data.quotes?.find((q) => q.symbol === ticker);
    return quote?.longname ?? quote?.shortname ?? fallback;
  } catch {
    return fallback;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const refs = await loadRefIds(client);

    const files = fs
      .readdirSync(SEED_DIR)
      .filter((f) => f.endsWith(".csv"))
      .sort();
    console.log(`Found ${files.length} CSV files`);

    const allRows: CsvRow[] = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(SEED_DIR, file), "utf-8");
      const rows = parse(content, { columns: true, skip_empty_lines: true }) as CsvRow[];
      allRows.push(...rows);
    }
    console.log(`Total raw rows: ${allRows.length}`);

    // Group partial fills by order_id
    const orderMap = new Map<string, CsvRow[]>();
    for (const row of allRows) {
      const fills = orderMap.get(row.order_id) ?? [];
      fills.push(row);
      orderMap.set(row.order_id, fills);
    }
    console.log(`Unique orders after aggregation: ${orderMap.size}`);

    // Aggregate each order and collect unique assets keyed by ISIN
    type AssetEntry = {
      symbol: string;
      name: string;
      categoryId: number;
      tickerSymbol: string;
      exchange: string;
    };
    type AggOrder = {
      isin: string;
      type: string;
      totalQty: Decimal;
      totalAmount: Decimal;
      weightedPrice: Decimal;
      transactedAt: string;
    };

    const assetByIsin = new Map<string, AssetEntry>();
    const orders: AggOrder[] = [];

    for (const [, fills] of orderMap) {
      const first = fills[0];

      let totalQty = new Decimal(0);
      let totalAmount = new Decimal(0);
      let earliestTime = first.order_execution_time;

      for (const fill of fills) {
        const qty = new Decimal(fill.quantity);
        const price = new Decimal(fill.price);
        totalQty = totalQty.plus(qty);
        totalAmount = totalAmount.plus(qty.times(price));
        if (fill.order_execution_time < earliestTime) {
          earliestTime = fill.order_execution_time;
        }
      }

      const weightedPrice = totalQty.gt(0) ? totalAmount.div(totalQty) : new Decimal(0);
      orders.push({
        isin: first.isin,
        type: first.trade_type,
        totalQty,
        totalAmount,
        weightedPrice,
        transactedAt: earliestTime.substring(0, 10),
      });

      if (!assetByIsin.has(first.isin)) {
        const suffix = first.exchange === "BSE" ? "BO" : "NS";
        assetByIsin.set(first.isin, {
          symbol: first.symbol,
          name: first.symbol, // placeholder — overwritten by Yahoo Finance lookup below
          categoryId: first.isin === GOLD_ETF_ISIN ? refs.goldId : refs.indianEquityId,
          tickerSymbol: `${first.symbol}.${suffix}`,
          exchange: first.exchange,
        });
      }
    }

    // Fetch real company names from Yahoo Finance (150ms between calls to respect rate limits)
    console.log(`Fetching company names for ${assetByIsin.size} unique assets from Yahoo Finance...`);
    let fetched = 0;
    let fallbackCount = 0;
    for (const [isin, asset] of assetByIsin) {
      const companyName = await fetchCompanyName(asset.tickerSymbol, asset.symbol);
      if (companyName === asset.symbol) fallbackCount++;
      asset.name = companyName;
      fetched++;
      if (fetched % 10 === 0) {
        console.log(`  ${fetched}/${assetByIsin.size} names fetched...`);
      }
      await sleep(150);
    }
    console.log(`Company name lookup complete. Fallback to symbol: ${fallbackCount}/${assetByIsin.size}`);

    await client.query("BEGIN");

    // Insert assets — ON CONFLICT (name) DO UPDATE handles re-runs
    const isinToStagingId = new Map<string, number>();

    for (const [isin, asset] of assetByIsin) {
      const result = await client.query<{ id: number }>(
        `INSERT INTO asset_stage (name, investment_category_id, ticker_symbol, exchange, price_source, currency_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO UPDATE SET
           investment_category_id = EXCLUDED.investment_category_id,
           ticker_symbol          = EXCLUDED.ticker_symbol,
           exchange               = EXCLUDED.exchange,
           price_source           = EXCLUDED.price_source,
           currency_id            = EXCLUDED.currency_id
         RETURNING id`,
        [
          asset.name,
          asset.categoryId,
          asset.tickerSymbol,
          asset.exchange,
          "yahoo_finance",
          refs.inrCurrencyId,
        ],
      );
      isinToStagingId.set(isin, result.rows[0].id);
    }

    // Insert transactions using asset_stage.id as asset_id
    for (const order of orders) {
      const assetStagingId = isinToStagingId.get(order.isin)!;
      await client.query(
        `INSERT INTO investment_transaction_stage
           (asset_id, person_id, financial_institution_id, type,
            quantity, price, amount, currency_id, transacted_at, amount_inr)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          assetStagingId,
          refs.primaryPersonId,
          refs.zerodhFinInstId,
          order.type,
          order.totalQty.toFixed(8),
          order.weightedPrice.toFixed(4),
          order.totalAmount.toFixed(4),
          refs.inrCurrencyId,
          order.transactedAt,
          order.totalAmount.toFixed(4), // INR asset — amount_inr = amount
        ],
      );
    }

    await client.query("COMMIT");

    console.log(`Inserted/updated ${assetByIsin.size} asset(s) in asset_stage`);
    console.log(`Inserted ${orders.length} transaction(s) in investment_transaction_stage`);
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
