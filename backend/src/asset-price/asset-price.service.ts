import { Injectable, Logger } from "@nestjs/common";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import Decimal from "decimal.js";
import { CurrencyService } from "./currency.service";

const AMFI_DISK_CACHE_PATH = join(process.cwd(), ".cache", "amfi-nav.json");

export type PriceSource = "yahoo_finance" | "amfi" | "coinmarketcap" | "gold_api" | "manual" | null;

const COINGECKO_ID: Record<string, string> = {
  "BTC-INR": "bitcoin",
  "ETH-INR": "ethereum",
  "SOL-INR": "solana",
};

export type AssetPriceRow = {
  id: number;
  ticker_symbol: string | null;
  price_source: PriceSource;
};

export type FinnhubNativeResult = { priceInr: Decimal; priceUsd: Decimal };

type CacheEntry = { priceInr: Decimal; fetchedAt: Date };

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const AMFI_NAV_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — MF NAVs update once per day
const AMFI_NAV_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";
const REFRESH_SLEEP_MS = 1000;
const YAHOO_FINANCE_BATCH_CONCURRENCY = 5;
const YAHOO_FINANCE_HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Origin: "https://finance.yahoo.com",
  Referer: "https://finance.yahoo.com/",
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

@Injectable()
export class AssetPriceService {
  private readonly logger = new Logger(AssetPriceService.name);
  private readonly cache = new Map<number, CacheEntry>();
  private amfiNavCache: { navByCode: Map<string, string>; fetchedAt: Date } | null = null;

  constructor(private readonly currencyService: CurrencyService) {}

  async getPriceInr(asset: AssetPriceRow): Promise<Decimal | null> {
    if (!asset.price_source || asset.price_source === "manual" || !asset.ticker_symbol) {
      return null;
    }

    const cached = this.cache.get(asset.id);
    if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
      return cached.priceInr;
    }

    try {
      const priceInr = await this.fetchPrice(asset.price_source, asset.ticker_symbol);
      if (priceInr !== null) {
        this.cache.set(asset.id, { priceInr, fetchedAt: new Date() });
      }
      return priceInr;
    } catch (err) {
      this.logger.error(`Price fetch failed for asset ${asset.id}: ${err}`);
      return null;
    }
  }

  /**
   * Batch-fetches prices for all yahoo_finance assets.
   * Indian stocks (.NS/.BO) → Yahoo Finance v8 chart API (5 concurrent, 1s between batches)
   * US stocks (no suffix) → Finnhub (sequential with 1s delay)
   * Also populates per-asset cache so subsequent getPriceInr calls are fast.
   */
  async batchFetchYahooFinancePrices(
    assets: AssetPriceRow[],
  ): Promise<Map<number, Decimal | null>> {
    const indianAssets = assets.filter(
      (a) => a.ticker_symbol?.endsWith(".NS") || a.ticker_symbol?.endsWith(".BO"),
    );
    const usAssets = assets.filter(
      (a) =>
        a.ticker_symbol && !a.ticker_symbol.endsWith(".NS") && !a.ticker_symbol.endsWith(".BO"),
    );

    const [indianPrices, usPrices] = await Promise.all([
      this.batchFetchIndianStocks(indianAssets),
      this.batchFetchFinnhub(usAssets),
    ]);

    for (const [id, price] of [...indianPrices, ...usPrices]) {
      if (price) this.cache.set(id, { priceInr: price, fetchedAt: new Date() });
    }

    return new Map([...indianPrices, ...usPrices]);
  }

  async batchFetchFinnhubWithNative(
    assets: AssetPriceRow[],
  ): Promise<Map<number, FinnhubNativeResult | null>> {
    if (assets.length === 0) return new Map();

    const usdToInr = await this.currencyService.getUsdToInr();
    const results: [number, FinnhubNativeResult | null][] = [];
    for (let i = 0; i < assets.length; i += YAHOO_FINANCE_BATCH_CONCURRENCY) {
      if (i > 0) await sleep(REFRESH_SLEEP_MS);
      const chunk = assets.slice(i, i + YAHOO_FINANCE_BATCH_CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (asset): Promise<[number, FinnhubNativeResult | null]> => {
          try {
            const priceUsd = await this.fetchYahooFinanceChart(asset.ticker_symbol!);
            if (!priceUsd) return [asset.id, null];
            return [asset.id, { priceUsd, priceInr: priceUsd.mul(usdToInr) }];
          } catch (err) {
            this.logger.error(`Yahoo Finance fetch failed for ${asset.ticker_symbol}: ${err}`);
            return [asset.id, null];
          }
        }),
      );
      results.push(...chunkResults);
    }
    return new Map(results);
  }

  private async batchFetchIndianStocks(
    assets: AssetPriceRow[],
  ): Promise<Map<number, Decimal | null>> {
    const eligible = assets.filter((a) => a.ticker_symbol);
    if (eligible.length === 0) return new Map();

    const results: [number, Decimal | null][] = [];
    for (let i = 0; i < eligible.length; i += YAHOO_FINANCE_BATCH_CONCURRENCY) {
      if (i > 0) await sleep(REFRESH_SLEEP_MS);
      const chunk = eligible.slice(i, i + YAHOO_FINANCE_BATCH_CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (asset): Promise<[number, Decimal | null]> => {
          try {
            const price = await this.fetchYahooFinanceChart(asset.ticker_symbol!);
            return [asset.id, price];
          } catch (err) {
            this.logger.error(`Yahoo Finance fetch failed for ${asset.ticker_symbol}: ${err}`);
            return [asset.id, null];
          }
        }),
      );
      results.push(...chunkResults);
    }

    return new Map(results);
  }

  private async fetchYahooFinanceChart(ticker: string): Promise<Decimal | null> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d&includePrePost=false`;
    const res = await fetch(url, { headers: YAHOO_FINANCE_HEADERS });
    if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
    const data = (await res.json()) as {
      chart: { result: Array<{ meta: { regularMarketPrice: number } }> | null; error?: unknown };
    };
    const price = data.chart?.result?.[0]?.meta?.regularMarketPrice;
    return price ? new Decimal(price) : null;
  }

  private async batchFetchFinnhub(assets: AssetPriceRow[]): Promise<Map<number, Decimal | null>> {
    if (assets.length === 0) return new Map();
    const results: [number, Decimal | null][] = [];
    for (let i = 0; i < assets.length; i++) {
      if (i > 0) await sleep(REFRESH_SLEEP_MS);
      try {
        const price = await this.fetchFinnhub(assets[i].ticker_symbol!);
        results.push([assets[i].id, price]);
      } catch {
        results.push([assets[i].id, null]);
      }
    }
    return new Map(results);
  }

  private async fetchPrice(
    source: NonNullable<PriceSource>,
    ticker: string,
  ): Promise<Decimal | null> {
    switch (source) {
      case "yahoo_finance":
        return this.fetchYahooFinance(ticker);
      case "amfi":
        return this.fetchAmfi(ticker);
      case "coinmarketcap":
        return this.fetchCoinGecko(ticker);
      case "gold_api":
        return this.fetchGoldApi(ticker);
      default:
        return null;
    }
  }

  private async fetchYahooFinance(ticker: string): Promise<Decimal | null> {
    const isIndian = ticker.endsWith(".NS") || ticker.endsWith(".BO");
    if (isIndian) {
      return this.fetchYahooFinanceChart(ticker);
    }
    // US stocks: Yahoo Finance returns USD price; multiply by live USD/INR
    const priceUsd = await this.fetchYahooFinanceChart(ticker);
    if (!priceUsd) return null;
    const usdToInr = await this.currencyService.getUsdToInr();
    return priceUsd.mul(usdToInr);
  }

  private async fetchFinnhub(ticker: string): Promise<Decimal | null> {
    const apiKey = process.env.FINNHUB_API_KEY;
    const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);

    const data = (await res.json()) as { c: number };
    if (!data.c || data.c === 0) return null;

    const usdToInr = await this.currencyService.getUsdToInr();
    return new Decimal(data.c).mul(usdToInr);
  }

  private async fetchFinnhubWithNative(ticker: string): Promise<FinnhubNativeResult | null> {
    const apiKey = process.env.FINNHUB_API_KEY;
    const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);

    const data = (await res.json()) as { c: number };
    if (!data.c || data.c === 0) return null;

    const usdToInr = await this.currencyService.getUsdToInr();
    const priceUsd = new Decimal(data.c);
    return { priceUsd, priceInr: priceUsd.mul(usdToInr) };
  }

  private async fetchAmfi(schemeCode: string): Promise<Decimal | null> {
    if (
      !this.amfiNavCache ||
      Date.now() - this.amfiNavCache.fetchedAt.getTime() > AMFI_NAV_TTL_MS
    ) {
      await this.loadAmfiNavCache();
    }

    const nav = this.amfiNavCache!.navByCode.get(schemeCode);
    return nav ? new Decimal(nav) : null;
  }

  private async loadAmfiNavCache(): Promise<void> {
    // Try disk cache first — survives container restarts via the ./backend volume mount
    try {
      const raw = await readFile(AMFI_DISK_CACHE_PATH, "utf-8");
      const parsed = JSON.parse(raw) as { fetchedAt: string; entries: [string, string][] };
      const fetchedAt = new Date(parsed.fetchedAt);
      if (Date.now() - fetchedAt.getTime() < AMFI_NAV_TTL_MS) {
        this.amfiNavCache = { navByCode: new Map(parsed.entries), fetchedAt };
        return;
      }
    } catch {
      // No disk cache or stale — fall through to network fetch
    }

    // Fetch from AMFI
    const res = await fetch(AMFI_NAV_URL);
    if (!res.ok) throw new Error(`AMFI HTTP ${res.status}`);
    const text = await res.text();
    const navByCode = new Map<string, string>();
    for (const line of text.split("\n")) {
      const parts = line.split(";");
      if (parts.length >= 5 && parts[4].trim()) {
        navByCode.set(parts[0].trim(), parts[4].trim());
      }
    }
    const fetchedAt = new Date();
    this.amfiNavCache = { navByCode, fetchedAt };

    // Persist to disk asynchronously (don't await — don't block the caller)
    void this.writeAmfiNavCache(navByCode, fetchedAt);
  }

  private async writeAmfiNavCache(navByCode: Map<string, string>, fetchedAt: Date): Promise<void> {
    try {
      await mkdir(join(process.cwd(), ".cache"), { recursive: true });
      await writeFile(
        AMFI_DISK_CACHE_PATH,
        JSON.stringify({ fetchedAt: fetchedAt.toISOString(), entries: [...navByCode] }),
        "utf-8",
      );
    } catch (err) {
      this.logger.warn(`Failed to write AMFI disk cache: ${err}`);
    }
  }

  private async fetchCoinGecko(tickerSymbol: string): Promise<Decimal | null> {
    const geckoId = COINGECKO_ID[tickerSymbol] ?? tickerSymbol;
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${geckoId}&vs_currencies=inr`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

    const data = (await res.json()) as Record<string, { inr: number }>;
    const inrPrice = data[geckoId]?.inr;
    if (!inrPrice) return null;

    return new Decimal(inrPrice);
  }

  private async fetchGoldApi(metalSymbol: string): Promise<Decimal | null> {
    const apiKey = process.env.GOLD_API_KEY;
    const url = `https://www.goldapi.io/api/${metalSymbol}/INR`;
    const res = await fetch(url, {
      headers: { "x-access-token": apiKey ?? "", "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`GoldAPI HTTP ${res.status}`);

    const data = (await res.json()) as { price_gram_24k: number };
    if (!data.price_gram_24k) return null;

    return new Decimal(data.price_gram_24k);
  }
}
