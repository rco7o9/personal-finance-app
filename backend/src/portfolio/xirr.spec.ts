import { xirr, CashFlow } from "./xirr";

const d = (s: string) => new Date(s);

describe("xirr", () => {
  it("returns expected rate for a simple 2-flow case", () => {
    // Invest 1000 on day 0, receive 1100 one year later → ~10% return
    const flows: CashFlow[] = [
      { date: d("2024-01-01"), amount: -1000 },
      { date: d("2025-01-01"), amount: 1100 },
    ];
    const rate = xirr(flows);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(0.1, 3);
  });

  it("returns null for fewer than 2 cash flows", () => {
    expect(xirr([{ date: d("2024-01-01"), amount: -1000 }])).toBeNull();
    expect(xirr([])).toBeNull();
  });

  it("returns null when all flows are on the same date", () => {
    const flows: CashFlow[] = [
      { date: d("2024-01-01"), amount: -1000 },
      { date: d("2024-01-01"), amount: 1100 },
    ];
    expect(xirr(flows)).toBeNull();
  });

  it("handles multiple buy lots and a terminal value", () => {
    // Buy 500 at month 0, buy 500 at month 6, terminal value 1200 at month 12
    const flows: CashFlow[] = [
      { date: d("2024-01-01"), amount: -500 },
      { date: d("2024-07-01"), amount: -500 },
      { date: d("2025-01-01"), amount: 1200 },
    ];
    const rate = xirr(flows);
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(0); // profitable
  });

  it("returns a negative rate for a loss-making position", () => {
    // Invest 1000, get back only 800 after one year
    const flows: CashFlow[] = [
      { date: d("2024-01-01"), amount: -1000 },
      { date: d("2025-01-01"), amount: 800 },
    ];
    const rate = xirr(flows);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(-0.2, 3);
  });

  it("converges for a deeply negative return that causes seed 0.1 to diverge", () => {
    // Invest 1000, get back only 100 one year later → XIRR ≈ −90%.
    // Seed 0.1 causes Newton-Raphson to jump below −1 and diverge on the first step;
    // seed −0.9 is at the exact solution and converges immediately.
    const flows: CashFlow[] = [
      { date: d("2024-01-01"), amount: -1000 },
      { date: d("2025-01-01"), amount: 100 },
    ];
    const rate = xirr(flows);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(-0.9, 2);
  });
});
