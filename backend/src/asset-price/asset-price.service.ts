import { Injectable, Logger } from "@nestjs/common";
import Decimal from "decimal.js";
import { CurrencyService } from "./currency.service";

export type PriceSource =
  | "yahoo_finance"
  | "amfi"
  | "coinmarketcap"
  | "metals_api"
  | "manual"
  | null;

export type AssetPriceRow = {
  id: number;
  ticker_symbol: string | null;
  price_source: PriceSource;
};

type CacheEntry = { priceInr: Decimal; fetchedAt: Date };

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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

  private async fetchPrice(
    source: NonNullable<PriceSource>,
    ticker: string,
  ): Promise<Decimal | null> {
    switch (source) {
      case "yahoo_finance":
        return this.fetchFinnhub(ticker);
      case "amfi":
        return this.fetchAmfi(ticker);
      case "coinmarketcap":
        return this.fetchCoinGecko(ticker);
      case "metals_api":
        return this.fetchMetalsApi(ticker);
      default:
        return null;
    }
  }

  private async fetchFinnhub(ticker: string): Promise<Decimal | null> {
    const apiKey = process.env.FINNHUB_API_KEY;
    const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);

    const data = (await res.json()) as { c: number };
    if (!data.c || data.c === 0) return null;

    const price = new Decimal(data.c);
    const isInr = ticker.endsWith(".NS") || ticker.endsWith(".BO");
    if (isInr) return price;

    const usdToInr = await this.currencyService.getUsdToInr();
    return price.mul(usdToInr);
  }

  private async fetchAmfi(schemeCode: string): Promise<Decimal | null> {
    const url = `https://api.mfapi.in/mf/${schemeCode}/latest`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mfapi HTTP ${res.status}`);

    const data = (await res.json()) as { data: { nav: string }[] };
    if (!data.data?.[0]?.nav) return null;

    return new Decimal(data.data[0].nav);
  }

  private async fetchCoinGecko(coinId: string): Promise<Decimal | null> {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=inr`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

    const data = (await res.json()) as Record<string, { inr: number }>;
    const inrPrice = data[coinId]?.inr;
    if (!inrPrice) return null;

    return new Decimal(inrPrice);
  }

  private async fetchMetalsApi(metalCode: string): Promise<Decimal | null> {
    const apiKey = process.env.METALS_API_KEY;
    const url = `https://metals-api.com/api/latest?access_key=${apiKey}&base=USD&symbols=${metalCode}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Metals-API HTTP ${res.status}`);

    const data = (await res.json()) as { rates: Record<string, number> };
    const rate = data.rates[metalCode];
    if (!rate) return null;

    // rate = troy ounces per USD → invert for USD per troy oz, then to INR per gram
    const usdToInr = await this.currencyService.getUsdToInr();
    return new Decimal(1).div(rate).mul(usdToInr).div(new Decimal("31.1035"));
  }
}
