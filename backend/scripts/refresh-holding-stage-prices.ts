/**
 * Refreshes current_price and current_value in holding_stage using the same
 * external APIs and env vars as the production refreshHoldingPrices() service.
 *
 * Sources used (matching asset_stage.price_source values):
 *   yahoo_finance + .NS/.BO → Indian Stock Market API (batch, max 10/request)
 *   yahoo_finance + no suffix → Finnhub (sequential, 1s delay)
 *   gold_api                 → GoldAPI (XAU/INR, price per gram)
 *   mfapi                    → mfapi.in /mf/{amfiCode}/latest (INR NAV, parallel)
 *   coinmarketcap            → CoinGecko simple/price (INR, single batch call)
 *                              ticker_symbol is exchange symbol (BTC-INR, ETH-INR, SOL-INR);
 *                              mapped to CoinGecko ids internally.
 *
 * All sources return or resolve to INR. native_currency stays unchanged for each asset.
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

// Fetches today's USD → INR closing rate from Frankfurter.
// Called once per script run and shared across all US stock fetches.
async function fetchCurrentUsdToInr(): Promise<Decimal> {
  const res = await fetch(`https://api.frankfurter.dev/v1/latest?from=USD&to=INR`);
  if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
  const data = (await res.json()) as { rates: { INR: number } };
  return new Decimal(data.rates.INR);
}

// usdToInr must be fetched once before calling this in a loop.
// Returns:
//   priceUsd  → current market price in USD  (goes into current_price_native / current_value_native)
//   priceInr  → priceUsd × usdToInr          (goes into current_price / current_value)
async function fetchFinnhub(
  ticker: string,
  usdToInr: Decimal,
): Promise<{ priceInr: Decimal; priceUsd: Decimal } | null> {
  const apiKey = process.env.FINNHUB_API_KEY;
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

// mfapi.in — free, no key, returns latest NAV in INR for a given AMFI scheme code.
// Response: { data: [{ date: "DD-MM-YYYY", nav: "87.4905" }] }
async function fetchMfNav(amfiCode: string): Promise<Decimal | null> {
  const url = `https://api.mfapi.in/mf/${amfiCode}/latest`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mfapi HTTP ${res.status}`);
    const data = (await res.json()) as { data: { nav: string }[] };
    if (!data.data?.[0]?.nav) return null;
    return new Decimal(data.data[0].nav);
  } catch (err) {
    console.error(`  mfapi failed for AMFI ${amfiCode}: ${err}`);
    return null;
  }
}

// Exchange symbol → CoinGecko id (ADR-008: ticker stores exchange symbol in staging;
// production asset table would store the CoinGecko id directly).
const COINGECKO_ID: Record<string, string> = {
  "BTC-INR": "bitcoin",
  "ETH-INR": "ethereum",
  "SOL-INR": "solana",
};

// CoinGecko free tier — no key, returns prices directly in INR.
// Single batch call for all crypto assets.
async function fetchCoinGecko(assets: AssetRow[]): Promise<Map<number, Decimal | null>> {
  const idByAssetId = new Map<number, string>();
  for (const a of assets) {
    const geckoId = COINGECKO_ID[a.ticker_symbol ?? ""] ?? a.ticker_symbol;
    if (geckoId) idByAssetId.set(a.id, geckoId);
  }

  const ids = [...new Set(idByAssetId.values())].join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=inr`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, { inr: number }>;
    return new Map(
      assets.map((a) => {
        const geckoId = idByAssetId.get(a.id);
        const price = geckoId ? data[geckoId]?.inr : undefined;
        return [a.id, price ? new Decimal(price) : null];
      }),
    );
  } catch (err) {
    console.error(`  CoinGecko failed: ${err}`);
    return new Map(assets.map((a) => [a.id, null]));
  }
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
    const mfAssets   = assets.filter((a) => a.price_source === "mfapi");
    const cryptoAssets = assets.filter((a) => a.price_source === "coinmarketcap");

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
    // Column semantics for USD assets:
    //   current_price / current_value         → INR  (USD price × today's USD→INR rate)
    //   current_price_native / current_value_native → USD  (raw USD price / USD value)
    //   avg_cost / total_invested              → INR  (historical; set by compute-holding-stage, not touched here)
    //   native_avg_cost / native_total_invested → USD (historical; set by compute-holding-stage, not touched here)
    if (usAssets.length > 0) {
      console.log(`Fetching ${usAssets.length} US stock price(s) via Finnhub...`);
      const usdToInr = await fetchCurrentUsdToInr();
      console.log(`  USD/INR rate (today): ${usdToInr.toFixed(4)}`);
      for (let i = 0; i < usAssets.length; i++) {
        if (i > 0) await sleep(SLEEP_MS);
        const a = usAssets[i];
        try {
          const result = await fetchFinnhub(a.ticker_symbol!, usdToInr);
          if (!result) { skipped++; continue; }
          await client.query(
            `UPDATE holding_stage SET
               current_price        = $1,          -- INR: USD price × today's rate
               current_value        = $1::numeric * quantity,  -- INR total
               current_price_native = $2,          -- USD: raw Finnhub price
               current_value_native = $2::numeric * quantity,  -- USD total
               native_currency      = 'USD'
             WHERE asset_id = $3`,
            [result.priceInr.toFixed(4), result.priceUsd.toFixed(4), a.id],
          );
          console.log(`  ${a.ticker_symbol}: $${result.priceUsd.toFixed(2)} → ₹${result.priceInr.toFixed(2)}`);
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

    // Mutual funds — mfapi.in, parallel, INR NAV
    if (mfAssets.length > 0) {
      console.log(`Fetching ${mfAssets.length} MF NAV(s) via mfapi.in...`);
      const navResults = await Promise.all(
        mfAssets.map(async (a) => ({ id: a.id, ticker: a.ticker_symbol, nav: await fetchMfNav(a.ticker_symbol!) })),
      );
      for (const { id, ticker, nav } of navResults) {
        if (!nav) {
          console.warn(`  No NAV returned for AMFI ${ticker}`);
          skipped++;
          continue;
        }
        await client.query(
          `UPDATE holding_stage SET
             current_price        = $1,
             current_value        = $1::numeric * quantity,
             current_price_native = $1,
             current_value_native = $1::numeric * quantity
           WHERE asset_id = $2`,
          [nav.toFixed(4), id],
        );
        console.log(`  AMFI ${ticker}: NAV = ₹${nav.toFixed(4)}`);
        updated++;
      }
    }

    // Crypto — CoinGecko, single batch call, INR prices
    if (cryptoAssets.length > 0) {
      console.log(`Fetching ${cryptoAssets.length} crypto price(s) via CoinGecko...`);
      const cryptoPrices = await fetchCoinGecko(cryptoAssets);
      for (const [id, price] of cryptoPrices) {
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

    console.log(`\nDone — updated: ${updated}, skipped: ${skipped}`);
  } finally {
    client.release();
    await pool.end();
  }
}

void run();
