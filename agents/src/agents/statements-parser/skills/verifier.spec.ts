import { verify, shouldSkip } from "./verifier";
import type { ParsedTransaction, SkillTemplate } from "../types";

const tx = (type: "debit" | "credit", amount: number): ParsedTransaction => ({
  date: "2024-01-15",
  description: "test",
  amount,
  type,
  rowType: "expense",
  confidence: 1.0,
  source_text: "test row",
});

describe("verify", () => {
  it("returns null when opening + credits - debits equals closing (exact)", () => {
    const txns = [tx("credit", 1000), tx("debit", 800)];
    // 5000 + 1000 - 800 = 5200
    expect(verify(txns, 5000, 5200)).toBeNull();
  });

  it("returns null when diff is within ₹1 tolerance", () => {
    const txns = [tx("credit", 1000)];
    // computed = 5000 + 1000 = 6000; expected = 6000.50; diff = 0.50 < 1.0
    expect(verify(txns, 5000, 6000.5)).toBeNull();
  });

  it("returns VerificationError when balance is wrong", () => {
    const txns = [tx("credit", 1000), tx("debit", 800)];
    // computed = 5200, expected = 5100, diff = 100
    const err = verify(txns, 5000, 5100);
    expect(err).not.toBeNull();
    expect(err!.computed).toBeCloseTo(5200);
    expect(err!.expected).toBeCloseTo(5100);
    expect(Math.abs(err!.diff)).toBeCloseTo(100);
  });

  it("handles empty transaction list", () => {
    // opening = closing → pass
    expect(verify([], 1000, 1000)).toBeNull();
    // opening ≠ closing → fail
    const err = verify([], 1000, 2000);
    expect(err).not.toBeNull();
  });
});

describe("shouldSkip", () => {
  it("returns true when balanceCheck is none", () => {
    expect(shouldSkip({ balanceCheck: "none" } as SkillTemplate)).toBe(true);
  });

  it("returns false when balanceCheck is opening_closing", () => {
    expect(shouldSkip({ balanceCheck: "opening_closing" } as SkillTemplate)).toBe(false);
  });

  it("returns false when balanceCheck is running_total", () => {
    expect(shouldSkip({ balanceCheck: "running_total" } as SkillTemplate)).toBe(false);
  });
});
