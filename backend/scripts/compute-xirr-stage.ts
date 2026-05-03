/**
 * Computes platform-wise and portfolio XIRR from investment_transaction_stage.
 * Currently-held assets (present in holding_stage) are treated as sold today
 * at their current market value.
 *
 * Cash flow convention:
 *   buy  → negative (money out)
 *   sell → positive (money in)
 *   terminal holding value → positive today
 *
 * Platform / currency matrix:
 *   Zerodha     INR   — Indian stocks + SGBs (amount_inr, current_value)
 *   IndMoney    INR   — US stocks in INR terms (amount_inr, current_value)
 *   IndMoney    USD   — US stocks in USD terms (amount, current_value_native)
 *   CoinSwitch  INR   — BTC/ETH/SOL, already INR-denominated (amount_inr, current_value)
 *   PayTM Money INR   — Mutual funds (amount_inr, current_value)
 *   Portfolio   INR   — All platforms combined
 *
 * Run: cd backend && npx ts-node --project tsconfig.scripts.json scripts/compute-xirr-stage.ts
 */

import * as dotenv from "dotenv";
import { Pool, PoolClient } from "pg";

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

// Computes XIRR for one platform in one currency.
// amountCol   — transaction column for cash flow amounts (amount_inr for INR, amount for USD)
// valueCol    — holding_stage column for terminal value (current_value for INR, current_value_native for USD)
// Terminal value = sum of valueCol for assets whose transactions come from this platform.
async function computePlatformXirr(
  client: PoolClient,
  fiId: number,
  amountCol: "amount_inr" | "amount",
  valueCol: "current_value" | "current_value_native",
  today: Date,
): Promise<number | null> {
  const { rows: txRows } = await client.query<{
    type: string;
    cf_amount: string;
    transacted_at: Date;
  }>(
    `SELECT type, ${amountCol}::text AS cf_amount, transacted_at
     FROM investment_transaction_stage
     WHERE financial_institution_id = $1
     ORDER BY transacted_at`,
    [fiId],
  );

  if (txRows.length === 0) return null;

  const { rows: holdRows } = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(h.${valueCol}), 0)::text AS total
     FROM holding_stage h
     WHERE h.asset_id IN (
       SELECT DISTINCT asset_id
       FROM investment_transaction_stage
       WHERE financial_institution_id = $1
     )
     AND h.${valueCol} IS NOT NULL`,
    [fiId],
  );

  const flows: CashFlow[] = txRows.map((r) => ({
    date: r.transacted_at,
    amount: r.type === "buy" ? -parseFloat(r.cf_amount) : parseFloat(r.cf_amount),
  }));

  const terminalValue = parseFloat(holdRows[0].total);
  if (terminalValue > 0) flows.push({ date: today, amount: terminalValue });

  return xirr(flows);
}

async function run(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const { rows: fiRows } = await client.query<{ id: number; name: string }>(
      "SELECT id, name FROM financial_institution",
    );
    const fiIdByName = new Map(fiRows.map((r) => [r.name, r.id]));

    const today = new Date();

    // --- Platform-wise XIRR -------------------------------------------
    const platforms: Array<{
      label: string;
      fiName: string;
      currency: "INR" | "USD";
      amountCol: "amount_inr" | "amount";
      valueCol: "current_value" | "current_value_native";
    }> = [
      {
        label: "Zerodha",
        fiName: "Zerodha",
        currency: "INR",
        amountCol: "amount_inr",
        valueCol: "current_value",
      },
      {
        label: "IndMoney",
        fiName: "INDMoney",
        currency: "INR",
        amountCol: "amount_inr",
        valueCol: "current_value",
      },
      {
        label: "IndMoney",
        fiName: "INDMoney",
        currency: "USD",
        amountCol: "amount",
        valueCol: "current_value_native",
      },
      {
        label: "CoinSwitch",
        fiName: "CoinSwitch",
        currency: "INR",
        amountCol: "amount_inr",
        valueCol: "current_value",
      },
      {
        label: "PayTM Money",
        fiName: "PayTM Money",
        currency: "INR",
        amountCol: "amount_inr",
        valueCol: "current_value",
      },
    ];

    const results: { label: string; currency: string; rate: number | null }[] = [];

    for (const p of platforms) {
      const fiId = fiIdByName.get(p.fiName);
      if (fiId === undefined) {
        console.warn(`  Financial institution not found: "${p.fiName}"`);
        results.push({ label: p.label, currency: p.currency, rate: null });
        continue;
      }
      const rate = await computePlatformXirr(client, fiId, p.amountCol, p.valueCol, today);
      results.push({ label: p.label, currency: p.currency, rate });
    }

    // --- Portfolio XIRR (all platforms, INR) --------------------------
    const { rows: allTxRows } = await client.query<{
      type: string;
      amount_inr: string;
      transacted_at: Date;
    }>(
      `SELECT type, amount_inr::text, transacted_at
       FROM investment_transaction_stage
       ORDER BY transacted_at`,
    );
    const { rows: allHoldRows } = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(current_value), 0)::text AS total
       FROM holding_stage
       WHERE current_value IS NOT NULL`,
    );

    const portfolioFlows: CashFlow[] = allTxRows.map((r) => ({
      date: r.transacted_at,
      amount: r.type === "buy" ? -parseFloat(r.amount_inr) : parseFloat(r.amount_inr),
    }));
    const portfolioTerminal = parseFloat(allHoldRows[0].total);
    if (portfolioTerminal > 0) portfolioFlows.push({ date: today, amount: portfolioTerminal });
    const portfolioRate = xirr(portfolioFlows);

    // --- Print table --------------------------------------------------
    const LW = 16;
    const CW = 9;
    const XW = 10;
    const header = `${"Platform".padEnd(LW)} ${"Currency".padEnd(CW)} ${"XIRR".padStart(XW)}`;
    const divider = "─".repeat(header.length);

    console.log("\n" + header);
    console.log(divider);
    for (const r of results) {
      const xirrStr = r.rate !== null ? `${(r.rate * 100).toFixed(2)}%` : "n/a";
      console.log(`${r.label.padEnd(LW)} ${r.currency.padEnd(CW)} ${xirrStr.padStart(XW)}`);
    }
    console.log(divider);
    const portfolioStr = portfolioRate !== null ? `${(portfolioRate * 100).toFixed(2)}%` : "n/a";
    console.log(
      `${"Portfolio (all)".padEnd(LW)} ${"INR".padEnd(CW)} ${portfolioStr.padStart(XW)}`,
    );
    console.log();
  } finally {
    client.release();
    await pool.end();
  }
}

void run();
