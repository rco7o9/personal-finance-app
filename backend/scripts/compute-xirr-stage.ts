/**
 * Computes a single portfolio XIRR from investment_transaction_stage.
 * Currently-held assets (present in holding_stage with current_value) are
 * treated as sold today at their current market value.
 *
 * Cash flow convention:
 *   buy  → negative (money out)
 *   sell → positive (money in)
 *   terminal holding value → positive today
 *
 * Run: cd backend && npx ts-node --project tsconfig.scripts.json scripts/compute-xirr-stage.ts
 */

import * as dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

type CashFlow = { date: Date; amount: number };

const MAX_ITERATIONS = 100;
const TOLERANCE = 1e-6;
const DAYS_PER_YEAR = 365;

function xirr(cashFlows: CashFlow[]): number | null {
  if (cashFlows.length < 2) return null;
  const dates = cashFlows.map((cf) => cf.date.getTime());
  const t0 = Math.min(...dates);
  if (new Set(dates).size < 2) return null;
  const t = cashFlows.map((cf) => (cf.date.getTime() - t0) / (DAYS_PER_YEAR * 86400000));
  const amounts = cashFlows.map((cf) => cf.amount);
  const npv = (r: number) => amounts.reduce((s, a, i) => s + a / Math.pow(1 + r, t[i]), 0);
  const dnpv = (r: number) =>
    amounts.reduce((s, a, i) => s + (-t[i] * a) / Math.pow(1 + r, t[i] + 1), 0);
  let rate = 0.1;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const df = dnpv(rate);
    if (Math.abs(df) < 1e-12) return null;
    const next = rate - npv(rate) / df;
    if (Math.abs(next - rate) < TOLERANCE) return next;
    rate = next;
    if (!isFinite(rate) || rate <= -1) return null;
  }
  return null;
}

async function run(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const { rows: txRows } = await client.query<{
      type: string;
      amount_inr: string;
      transacted_at: Date;
    }>(
      `SELECT type, amount_inr::text, transacted_at
       FROM investment_transaction_stage
       ORDER BY transacted_at`,
    );

    const { rows: holdingRows } = await client.query<{ current_value: string }>(
      `SELECT COALESCE(SUM(current_value), 0)::text AS current_value
       FROM holding_stage
       WHERE current_value IS NOT NULL`,
    );

    const today = new Date();
    const flows: CashFlow[] = txRows.map((r) => ({
      date: r.transacted_at,
      amount: r.type === "buy" ? -parseFloat(r.amount_inr) : parseFloat(r.amount_inr),
    }));

    const terminalValue = parseFloat(holdingRows[0].current_value);
    if (terminalValue > 0) {
      flows.push({ date: today, amount: terminalValue });
    }

    const rate = xirr(flows);
    if (rate === null) {
      console.log("XIRR: could not converge");
    } else {
      console.log(`Portfolio XIRR: ${(rate * 100).toFixed(2)}%`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

void run();
