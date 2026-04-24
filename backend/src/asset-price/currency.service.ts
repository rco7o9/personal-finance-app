import { Injectable, Logger } from "@nestjs/common";
import Decimal from "decimal.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);
  private cached: { rate: Decimal; fetchedAt: Date } | null = null;

  async getUsdToInr(): Promise<Decimal> {
    if (this.cached && Date.now() - this.cached.fetchedAt.getTime() < CACHE_TTL_MS) {
      return this.cached.rate;
    }

    try {
      const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=INR");
      if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);

      const data = (await res.json()) as { rates: { INR: number } };
      const rate = new Decimal(data.rates.INR);
      this.cached = { rate, fetchedAt: new Date() };
      return rate;
    } catch (err) {
      this.logger.error(`USD/INR fetch failed: ${err}`);
      if (this.cached) return this.cached.rate;
      return new Decimal("85");
    }
  }
}
