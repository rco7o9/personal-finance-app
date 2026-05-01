/**
 * Recomputes holding_stage from the current state of investment_transaction_stage.
 * Run after each parser script (or after manual edits) to see the net positions.
 *
 * Algorithm — running weighted-average cost with full-exit reset:
 *   Process each asset's transactions in chronological order.
 *   On buy:  qty += buy_qty;  cost += buy_amount
 *   On sell: cost -= cost_per_share × sell_qty;  qty -= sell_qty
 *   If qty reaches 0 after a sell → reset cost to 0 (fresh slate for next buys)
 *   This correctly handles stocks that were fully sold and then re-bought at new prices.
 *
 * Run: cd backend && npx ts-node --project tsconfig.scripts.json scripts/compute-holding-stage.ts
 */

import * as dotenv from "dotenv";
import { Pool } from "pg";
import Decimal from "decimal.js";

dotenv.config();

type TxRow = {
  asset_id: number;
  name: string;
  ticker_symbol: string;
  type: string;
  quantity: string;
  amount: string;
  transacted_at: Date;
};

type HoldingResult = {
  asset_id: number;
  name: string;
  ticker_symbol: string;
  qty: Decimal;
  totalInvested: Decimal;
  avgCost: Decimal;
};

function computeHolding(txs: TxRow[]): HoldingResult {
  const sorted = [...txs].sort(
    (a, b) => a.transacted_at.getTime() - b.transacted_at.getTime(),
  );

  let runningQty = new Decimal(0);
  let runningCost = new Decimal(0);

  for (const tx of sorted) {
    const qty = new Decimal(tx.quantity);
    const amount = new Decimal(tx.amount);

    if (tx.type === "buy") {
      runningQty = runningQty.plus(qty);
      runningCost = runningCost.plus(amount);
    } else {
      // Sell: remove the proportional cost of shares being sold
      if (runningQty.gt(0)) {
        const costPerShare = runningCost.div(runningQty);
        runningCost = runningCost.minus(costPerShare.times(qty));
        runningQty = runningQty.minus(qty);
      }
      // Full exit — reset cost basis so next buys start clean
      if (runningQty.lte(0)) {
        runningQty = new Decimal(0);
        runningCost = new Decimal(0);
      }
    }
  }

  const avgCost = runningQty.gt(0) ? runningCost.div(runningQty) : new Decimal(0);

  return {
    asset_id: txs[0].asset_id,
    name: txs[0].name,
    ticker_symbol: txs[0].ticker_symbol,
    qty: runningQty,
    totalInvested: runningCost,
    avgCost,
  };
}

async function run(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const result = await client.query<TxRow>(
      `SELECT
         t.asset_id,
         a.name,
         a.ticker_symbol,
         t.type,
         t.quantity::text,
         t.amount::text,
         t.transacted_at
       FROM investment_transaction_stage t
       JOIN asset_stage a ON a.id = t.asset_id
       ORDER BY t.asset_id, t.transacted_at`,
    );

    // Group transactions by asset_id
    const byAsset = new Map<number, TxRow[]>();
    for (const row of result.rows) {
      const group = byAsset.get(row.asset_id) ?? [];
      group.push(row);
      byAsset.set(row.asset_id, group);
    }

    // Compute holdings using running-cost algorithm
    const holdings: HoldingResult[] = [];
    for (const txs of byAsset.values()) {
      const h = computeHolding(txs);
      if (h.qty.gt(0)) {
        holdings.push(h);
      }
    }

    holdings.sort((a, b) => a.ticker_symbol.localeCompare(b.ticker_symbol));

    await client.query("BEGIN");
    await client.query("DELETE FROM holding_stage");

    for (const h of holdings) {
      await client.query(
        `INSERT INTO holding_stage (asset_id, quantity, avg_cost, total_invested)
         VALUES ($1, $2, $3, $4)`,
        [h.asset_id, h.qty.toFixed(8), h.avgCost.toFixed(4), h.totalInvested.toFixed(4)],
      );
    }

    await client.query("COMMIT");

    console.log(`holding_stage updated — ${holdings.length} position(s):\n`);
    console.log(
      `${"#".padEnd(3)} ${"Ticker".padEnd(18)} ${"Name".padEnd(42)} ${"Qty".padStart(10)} ${"Avg Cost".padStart(10)} ${"Invested".padStart(14)}`,
    );
    console.log("-".repeat(100));
    holdings.forEach((h, i) => {
      console.log(
        `${String(i + 1).padEnd(3)} ${h.ticker_symbol.padEnd(18)} ${h.name.substring(0, 42).padEnd(42)} ${h.qty.toFixed(2).padStart(10)} ${h.avgCost.toFixed(2).padStart(10)} ${h.totalInvested.toFixed(2).padStart(14)}`,
      );
    });
    console.log("\nDone.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed — rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

void run();
