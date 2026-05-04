/**
 * Backfills native_currency, native_avg_cost, and native_total_invested on the holding table.
 * Uses investment_transaction.amount (original native currency) — not amount_inr.
 * Safe to re-run: NULL-resets INR assets, recomputes USD assets from scratch.
 *
 * Run: cd backend && npm run seed:native-columns
 * Requires DATABASE_URL in environment (or .env).
 */

import * as dotenv from "dotenv";
import { Pool } from "pg";
import Decimal from "decimal.js";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type PositionNativeRow = {
  asset_id: number;
  currency_code: string;
  net_qty: string;
  net_native: string;
};

async function run(): Promise<void> {
  const client = await pool.connect();
  try {
    // Aggregate net quantity and net native amount per asset, joined to currency
    const result = await client.query<PositionNativeRow>(
      `SELECT
         it.asset_id,
         c.code                                                                              AS currency_code,
         SUM(CASE WHEN it.type = 'buy' THEN it.quantity  ELSE -it.quantity  END)::text      AS net_qty,
         SUM(CASE WHEN it.type = 'buy' THEN it.amount    ELSE -it.amount    END)::text      AS net_native
       FROM investment_transaction it
       JOIN currency c ON c.id = it.currency_id
       WHERE it.status = 'confirmed'
       GROUP BY it.asset_id, c.code
       HAVING SUM(CASE WHEN it.type = 'buy' THEN it.quantity ELSE -it.quantity END) > 0`,
    );

    const usdRows = result.rows.filter((r) => r.currency_code === "USD");
    const inrRows = result.rows.filter((r) => r.currency_code !== "USD");

    console.log(`Found ${usdRows.length} USD holding(s) and ${inrRows.length} INR holding(s).`);

    await client.query("BEGIN");

    // NULL-reset all native columns first (idempotent baseline)
    await client.query(
      `UPDATE holding SET native_currency = NULL, native_avg_cost = NULL, native_total_invested = NULL`,
    );

    // Populate native columns for USD holdings
    let usdUpdated = 0;
    for (const row of usdRows) {
      const netQty = new Decimal(row.net_qty);
      const netNative = new Decimal(row.net_native);
      const nativeAvgCost = netQty.gt(0) ? netNative.div(netQty) : new Decimal(0);

      await client.query(
        `UPDATE holding SET
           native_currency       = 'USD',
           native_avg_cost       = $1,
           native_total_invested = $2
         WHERE asset_id = $3`,
        [nativeAvgCost.toFixed(4), netNative.toFixed(4), row.asset_id],
      );
      usdUpdated++;
    }

    await client.query("COMMIT");

    console.log(`Updated ${usdUpdated} USD holding(s) with native columns.`);
    console.log(`${inrRows.length} INR holding(s) left with NULL native columns.`);
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
