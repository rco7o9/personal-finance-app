export type CashFlow = {
  date: Date;
  amount: number; // negative = outflow (buy), positive = inflow (sell/terminal)
};

const MAX_ITERATIONS = 100;
const TOLERANCE = 1e-6;
const DAYS_PER_YEAR = 365;
const SEEDS = [0.1, -0.1, 0.5, -0.5, 2.0, -0.9];

/**
 * Computes XIRR (extended internal rate of return) using Newton-Raphson.
 * All cash flows must share the same currency.
 * Returns null when: fewer than 2 distinct dates, or all seeds fail to converge.
 */
export function xirr(cashFlows: CashFlow[]): number | null {
  if (cashFlows.length < 2) return null;

  const dates = cashFlows.map((cf) => cf.date.getTime());
  const t0 = Math.min(...dates);

  // Require at least 2 distinct dates
  const distinctDates = new Set(dates);
  if (distinctDates.size < 2) return null;

  // Fractional years from first cash flow
  const t = cashFlows.map((cf) => (cf.date.getTime() - t0) / (DAYS_PER_YEAR * 86400000));
  const amounts = cashFlows.map((cf) => cf.amount);

  // NPV(r) = Σ amount_i / (1 + r)^t_i
  const npv = (r: number): number =>
    amounts.reduce((sum, a, i) => sum + a / Math.pow(1 + r, t[i]), 0);

  // dNPV/dr = Σ -t_i * amount_i / (1 + r)^(t_i + 1)
  const dnpv = (r: number): number =>
    amounts.reduce((sum, a, i) => sum + (-t[i] * a) / Math.pow(1 + r, t[i] + 1), 0);

  for (const seed of SEEDS) {
    let rate = seed;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const f = npv(rate);
      const df = dnpv(rate);
      if (Math.abs(df) < 1e-12) break; // derivative too small — try next seed
      const next = rate - f / df;
      if (!isFinite(next) || next <= -1) break; // diverged — try next seed
      if (Math.abs(next - rate) < TOLERANCE) return next;
      rate = next;
    }
  }

  return null; // all seeds failed to converge
}
