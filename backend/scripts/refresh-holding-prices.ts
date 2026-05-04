/**
 * Rebuild holding from confirmed transactions and refresh current prices.
 * Run: cd backend && npx ts-node --project tsconfig.scripts.json scripts/refresh-holding-prices.ts
 */

import * as dotenv from "dotenv";
import { Pool } from "pg";
import { CurrencyService } from "../src/asset-price/currency.service";
import { AssetPriceService } from "../src/asset-price/asset-price.service";
import { PortfolioService } from "../src/portfolio/portfolio.service";

dotenv.config();

async function run(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const service = new PortfolioService(
      pool,
      new AssetPriceService(new CurrencyService()),
    );
    const { updated, skipped } = await service.refreshHoldingPrices();
    console.log(`Done — updated: ${updated}, skipped: ${skipped}`);
  } finally {
    await pool.end();
  }
}

void run();
