import { Injectable, Logger } from "@nestjs/common";
import Decimal from "decimal.js";
import { CurrencyService } from "./currency.service";

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
const INDIAN_STOCK_API = "http://65.0.104.9";
const REFRESH_SLEEP_MS = 1000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

@Injectable()
export class AssetPriceService {
  private readonly logger = new Logger(AssetPriceService.name);
  private readonly cache = new Map<number, CacheEntry>();

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
   * Batch-fetches prices for all yahoo_finance assets in one request per provider.
   * Indian stocks (.NS/.BO) → Indian Stock Market API (single batch call)
   * US stocks (no suffix) → Finnhub (parallel, already low count ~11)
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
    const results: [number, FinnhubNativeResult | null][] = [];
    for (let i = 0; i < assets.length; i++) {
      if (i > 0) await sleep(REFRESH_SLEEP_MS);
      try {
        const result = await this.fetchFinnhubWithNative(assets[i].ticker_symbol!);
        results.push([assets[i].id, result]);
      } catch {
        results.push([assets[i].id, null]);
      }
    }
    return new Map(results);
  }

  private async batchFetchIndianStocks(
    assets: AssetPriceRow[],
  ): Promise<Map<number, Decimal | null>> {
    const eligible = assets.filter((a) => a.ticker_symbol);
    if (eligible.length === 0) return new Map();

    // API allows max 10 symbols per request — chunk and fetch in parallel
    const CHUNK_SIZE = 10;
    const chunks: AssetPriceRow[][] = [];
    for (let i = 0; i < eligible.length; i += CHUNK_SIZE) {
      chunks.push(eligible.slice(i, i + CHUNK_SIZE));
    }

    const chunkResults: Map<number, Decimal | null>[] = [];
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await sleep(REFRESH_SLEEP_MS);
      chunkResults.push(await this.fetchIndianStockChunk(chunks[i]));
    }

    return new Map(chunkResults.flatMap((m) => [...m]));
  }

  private async fetchIndianStockChunk(
    assets: AssetPriceRow[],
    retries = 2,
  ): Promise<Map<number, Decimal | null>> {
    const symbols = assets.map((a) => a.ticker_symbol!).join(",");
    const url = `${INDIAN_STOCK_API}/stock/list?symbols=${symbols}&res=num`;

    let stocks: { ticker?: string; last_price?: number }[];
    try {
      const res = await fetch(url);
      // Retry on transient server errors
      if ((res.status === 503 || res.status === 504) && retries > 0) {
        await new Promise((r) => setTimeout(r, 1000));
        return this.fetchIndianStockChunk(assets, retries - 1);
      }
      if (!res.ok) throw new Error(`Indian Stock API HTTP ${res.status}`);
      const data = (await res.json()) as { stocks: { ticker?: string; last_price?: number }[] };
      stocks = data.stocks ?? [];
    } catch (err) {
      this.logger.error(`Batch Indian stock fetch failed: ${err}`);
      return new Map(assets.map((a) => [a.id, null]));
    }

    // Build ticker → price map from response (response ticker includes .NS suffix)
    const priceByTicker = new Map<string, number>();
    for (const s of stocks) {
      if (s.ticker && s.last_price) priceByTicker.set(s.ticker.toUpperCase(), s.last_price);
    }

    return new Map(
      assets.map((a) => {
        const price = priceByTicker.get(a.ticker_symbol!.toUpperCase());
        return [a.id, price ? new Decimal(price) : null];
      }),
    );
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
      const url = `${INDIAN_STOCK_API}/stock?symbol=${ticker}&res=num`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Indian Stock API HTTP ${res.status}`);
      const data = (await res.json()) as { data?: { last_price?: number } };
      const price = data.data?.last_price;
      return price ? new Decimal(price) : null;
    }
    return this.fetchFinnhub(ticker);
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
    const url = `https://api.mfapi.in/mf/${schemeCode}/latest`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mfapi HTTP ${res.status}`);

    const data = (await res.json()) as { data: { nav: string }[] };
    if (!data.data?.[0]?.nav) return null;

    return new Decimal(data.data[0].nav);
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
