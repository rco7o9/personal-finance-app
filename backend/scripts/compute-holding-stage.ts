/**
 * Recomputes holding_stage from the current state of investment_transaction_stage.
 * Run after each parser script (or after manual edits) to see the net positions.
 *
 * Algorithm — running weighted-average cost with full-exit reset:
 *   Process each asset's transactions in chronological order.
 *   On buy:  qty += buy_qty;  costInr += buy_amount_inr;  costNative += buy_amount
 *   On sell: remove proportional cost from both trackers;  qty -= sell_qty
 *   If qty reaches 0 after a sell → reset all accumulators (fresh slate for next buys)
 *
 *   avg_cost / total_invested    — always stored in INR (amount_inr column)
 *   native_avg_cost / native_total_invested — stored in native currency (USD) for non-INR assets
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
  currency_code: string;
  type: string;
  quantity: string;
  amount: string;      // native currency (USD for US stocks, INR for Indian)
  amount_inr: string;  // always INR
  transacted_at: Date;
};

type HoldingResult = {
  asset_id: number;
  name: string;
  ticker_symbol: string;
  currency_code: string;
  qty: Decimal;
  totalInvestedInr: Decimal;
  avgCostInr: Decimal;
  nativeTotalInvested: Decimal | null; // null for INR assets
  nativeAvgCost: Decimal | null;       // null for INR assets
};

function computeHolding(txs: TxRow[]): HoldingResult {
  const sorted = [...txs].sort(
    (a, b) => a.transacted_at.getTime() - b.transacted_at.getTime(),
  );
  const isNonInr = txs[0].currency_code !== "INR";

  let runningQty = new Decimal(0);
  let runningCostInr = new Decimal(0);
  let runningCostNative = new Decimal(0);

  for (const tx of sorted) {
    const qty = new Decimal(tx.quantity);
    const amountInr = new Decimal(tx.amount_inr);
    const amountNative = new Decimal(tx.amount);

    if (tx.type === "buy") {
      runningQty = runningQty.plus(qty);
      runningCostInr = runningCostInr.plus(amountInr);
      runningCostNative = runningCostNative.plus(amountNative);
    } else {
      if (runningQty.gt(0)) {
        const costPerShareInr = runningCostInr.div(runningQty);
        const costPerShareNative = runningCostNative.div(runningQty);
        runningCostInr = runningCostInr.minus(costPerShareInr.times(qty));
        runningCostNative = runningCostNative.minus(costPerShareNative.times(qty));
        runningQty = runningQty.minus(qty);
      }
      // Full exit — reset cost basis so next buys start clean
      if (runningQty.lte(0)) {
        runningQty = new Decimal(0);
        runningCostInr = new Decimal(0);
        runningCostNative = new Decimal(0);
      }
    }
  }

  const avgCostInr = runningQty.gt(0) ? runningCostInr.div(runningQty) : new Decimal(0);
  const nativeAvgCost =
    isNonInr && runningQty.gt(0) ? runningCostNative.div(runningQty) : null;

  return {
    asset_id: txs[0].asset_id,
    name: txs[0].name,
    ticker_symbol: txs[0].ticker_symbol,
    currency_code: txs[0].currency_code,
    qty: runningQty,
    totalInvestedInr: runningCostInr,
    avgCostInr,
    nativeTotalInvested: isNonInr ? runningCostNative : null,
    nativeAvgCost,
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
         c.code          AS currency_code,
         t.type,
         t.quantity::text,
         t.amount::text,
         t.amount_inr::text,
         t.transacted_at
       FROM investment_transaction_stage t
       JOIN asset_stage a ON a.id = t.asset_id
       JOIN currency c    ON c.id = t.currency_id
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
        `INSERT INTO holding_stage
           (asset_id, quantity, avg_cost, total_invested,
            native_currency, native_avg_cost, native_total_invested)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          h.asset_id,
          h.qty.toFixed(8),
          h.avgCostInr.toFixed(4),
          h.totalInvestedInr.toFixed(4),
          h.currency_code !== "INR" ? h.currency_code : null,
          h.nativeAvgCost?.toFixed(4) ?? null,
          h.nativeTotalInvested?.toFixed(4) ?? null,
        ],
      );
    }

    await client.query("COMMIT");

    // --- Display ---
    const inrHoldings = holdings.filter((h) => h.currency_code === "INR");
    const usdHoldings = holdings.filter((h) => h.currency_code !== "INR");

    console.log(`holding_stage updated — ${holdings.length} position(s)\n`);

    if (inrHoldings.length > 0) {
      console.log(`Indian Equity / Gold (${inrHoldings.length} positions):`);
      console.log(
        `${"#".padEnd(3)} ${"Ticker".padEnd(18)} ${"Name".padEnd(42)} ${"Qty".padStart(10)} ${"Avg Cost ₹".padStart(12)} ${"Invested ₹".padStart(14)}`,
      );
      console.log("-".repeat(102));
      inrHoldings.forEach((h, i) => {
        console.log(
          `${String(i + 1).padEnd(3)} ${h.ticker_symbol.padEnd(18)} ${h.name.substring(0, 42).padEnd(42)} ${h.qty.toFixed(2).padStart(10)} ${h.avgCostInr.toFixed(2).padStart(12)} ${h.totalInvestedInr.toFixed(2).padStart(14)}`,
        );
      });
    }

    if (usdHoldings.length > 0) {
      console.log(`\nUS Equity (${usdHoldings.length} positions):`);
      console.log(
        `${"#".padEnd(3)} ${"Ticker".padEnd(8)} ${"Name".padEnd(36)} ${"Qty".padStart(12)} ${"Avg $".padStart(10)} ${"Invested $".padStart(12)} ${"Invested ₹".padStart(14)}`,
      );
      console.log("-".repeat(98));
      usdHoldings.forEach((h, i) => {
        console.log(
          `${String(i + 1).padEnd(3)} ${h.ticker_symbol.padEnd(8)} ${h.name.substring(0, 36).padEnd(36)} ${h.qty.toFixed(6).padStart(12)} ${(h.nativeAvgCost?.toFixed(2) ?? "-").padStart(10)} ${(h.nativeTotalInvested?.toFixed(2) ?? "-").padStart(12)} ${h.totalInvestedInr.toFixed(2).padStart(14)}`,
        );
      });
    }

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
