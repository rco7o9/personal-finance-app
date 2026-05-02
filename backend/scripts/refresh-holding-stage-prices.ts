/**
 * Refreshes current_price and current_value in holding_stage using the same
 * external APIs and env vars as the production refreshHoldingPrices() service.
 *
 * Sources used (matching asset_stage.price_source values):
 *   yahoo_finance + .NS/.BO → Indian Stock Market API (batch, max 10/request)
 *   yahoo_finance + no suffix → Finnhub (sequential, 1s delay)
 *   gold_api                 → GoldAPI (XAU/INR)
 *
 * Run: cd backend && npx ts-node --project tsconfig.scripts.json scripts/refresh-holding-stage-prices.ts
 */

import * as dotenv from "dotenv";
import { Pool } from "pg";
import Decimal from "decimal.js";

dotenv.config();

const INDIAN_STOCK_API = "http://65.0.104.9";
const SLEEP_MS = 1000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type AssetRow = {
  id: number;
  ticker_symbol: string | null;
  price_source: string | null;
};

async function fetchIndianStockChunk(
  assets: AssetRow[],
  retries = 2,
): Promise<Map<number, Decimal | null>> {
  const symbols = assets.map((a) => a.ticker_symbol!).join(",");
  const url = `${INDIAN_STOCK_API}/stock/list?symbols=${symbols}&res=num`;
  try {
    const res = await fetch(url);
    if ((res.status === 503 || res.status === 504) && retries > 0) {
      await sleep(SLEEP_MS);
      return fetchIndianStockChunk(assets, retries - 1);
    }
    if (!res.ok) throw new Error(`Indian Stock API HTTP ${res.status}`);
    const data = (await res.json()) as { stocks: { ticker?: string; last_price?: number }[] };
    const priceByTicker = new Map<string, number>();
    for (const s of data.stocks ?? []) {
      if (s.ticker && s.last_price) priceByTicker.set(s.ticker.toUpperCase(), s.last_price);
    }
    return new Map(
      assets.map((a) => {
        const price = priceByTicker.get(a.ticker_symbol!.toUpperCase());
        return [a.id, price ? new Decimal(price) : null];
      }),
    );
  } catch (err) {
    console.error(`  Indian Stock API batch failed: ${err}`);
    return new Map(assets.map((a) => [a.id, null]));
  }
}

async function fetchIndianStocks(assets: AssetRow[]): Promise<Map<number, Decimal | null>> {
  const CHUNK = 10;
  const results = new Map<number, Decimal | null>();
  for (let i = 0; i < assets.length; i += CHUNK) {
    if (i > 0) await sleep(SLEEP_MS);
    const chunk = assets.slice(i, i + CHUNK);
    const chunkResult = await fetchIndianStockChunk(chunk);
    for (const [id, price] of chunkResult) results.set(id, price);
  }
  return results;
}

async function fetchFinnhub(ticker: string): Promise<{ priceInr: Decimal; priceUsd: Decimal } | null> {
  const apiKey = process.env.FINNHUB_API_KEY;
  const fxRes = await fetch(
    `https://api.frankfurter.dev/v1/latest?from=USD&to=INR`,
  );
  const fxData = (await fxRes.json()) as { rates: { INR: number } };
  const usdToInr = new Decimal(fxData.rates.INR);

  const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
  const data = (await res.json()) as { c: number };
  if (!data.c || data.c === 0) return null;
  const priceUsd = new Decimal(data.c);
  return { priceUsd, priceInr: priceUsd.mul(usdToInr) };
}

async function fetchGoldApi(): Promise<Decimal | null> {
  const apiKey = process.env.GOLD_API_KEY;
  const url = `https://www.goldapi.io/api/XAU/INR`;
  const res = await fetch(url, {
    headers: { "x-access-token": apiKey ?? "", "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`GoldAPI HTTP ${res.status}`);
  const data = (await res.json()) as { price_gram_24k: number };
  if (!data.price_gram_24k) return null;
  return new Decimal(data.price_gram_24k);
}

async function run(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const { rows: assets } = await client.query<AssetRow>(
      `SELECT a.id, a.ticker_symbol, a.price_source::text
       FROM asset_stage a
       JOIN holding_stage h ON h.asset_id = a.id
       WHERE a.price_source IS NOT NULL AND a.price_source != 'manual'`,
    );

    console.log(`Found ${assets.length} asset(s) in holding_stage to price`);

    const indianAssets = assets.filter(
      (a) => a.price_source === "yahoo_finance" &&
             (a.ticker_symbol?.endsWith(".NS") || a.ticker_symbol?.endsWith(".BO")),
    );
    const usAssets = assets.filter(
      (a) => a.price_source === "yahoo_finance" &&
             !a.ticker_symbol?.endsWith(".NS") && !a.ticker_symbol?.endsWith(".BO"),
    );
    const goldAssets = assets.filter((a) => a.price_source === "gold_api");

    let updated = 0;
    let skipped = 0;

    // Indian stocks — batch fetch
    if (indianAssets.length > 0) {
      console.log(`Fetching ${indianAssets.length} Indian stock price(s)...`);
      const prices = await fetchIndianStocks(indianAssets);
      for (const [id, price] of prices) {
        if (!price) { skipped++; continue; }
        await client.query(
          `UPDATE holding_stage SET
             current_price        = $1,
             current_value        = $1::numeric * quantity,
             current_price_native = $1,
             current_value_native = $1::numeric * quantity
           WHERE asset_id = $2`,
          [price.toFixed(4), id],
        );
        updated++;
      }
    }

    // US stocks — Finnhub sequential
    if (usAssets.length > 0) {
      console.log(`Fetching ${usAssets.length} US stock price(s) via Finnhub...`);
      for (let i = 0; i < usAssets.length; i++) {
        if (i > 0) await sleep(SLEEP_MS);
        const a = usAssets[i];
        try {
          const result = await fetchFinnhub(a.ticker_symbol!);
          if (!result) { skipped++; continue; }
          await client.query(
            `UPDATE holding_stage SET
               current_price        = $1,
               current_value        = $1::numeric * quantity,
               current_price_native = $2,
               current_value_native = $2::numeric * quantity,
               native_currency      = 'USD'
             WHERE asset_id = $3`,
            [result.priceInr.toFixed(4), result.priceUsd.toFixed(4), a.id],
          );
          updated++;
        } catch (err) {
          console.error(`  Finnhub failed for ${a.ticker_symbol}: ${err}`);
          skipped++;
        }
      }
    }

    // Gold — single GoldAPI call, apply to all gold assets
    if (goldAssets.length > 0) {
      console.log(`Fetching gold price via GoldAPI...`);
      try {
        const goldPrice = await fetchGoldApi();
        if (!goldPrice) {
          skipped += goldAssets.length;
        } else {
          for (const a of goldAssets) {
            await client.query(
              `UPDATE holding_stage SET
                 current_price        = $1,
                 current_value        = $1::numeric * quantity,
                 current_price_native = $1,
                 current_value_native = $1::numeric * quantity
               WHERE asset_id = $2`,
              [goldPrice.toFixed(4), a.id],
            );
            updated++;
          }
        }
      } catch (err) {
        console.error(`  GoldAPI failed: ${err}`);
        skipped += goldAssets.length;
      }
    }

    console.log(`\nDone — updated: ${updated}, skipped: ${skipped}`);
  } finally {
    client.release();
    await pool.end();
  }
}

void run();
