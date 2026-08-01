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

  describe("liability mode (credit card)", () => {
    it("returns null when opening + debits - credits equals closing", () => {
      // A purchase (debit) increases what's owed; a payment (credit) reduces it —
      // the mirror image of the default asset-account mode.
      const txns = [tx("debit", 5000), tx("credit", 2000)];
      // 1000 + 5000 - 2000 = 4000
      expect(verify(txns, 1000, 4000, "liability")).toBeNull();
    });

    it("returns VerificationError when the asset-mode formula would wrongly pass", () => {
      // Same transactions, but checked against the closing balance that the
      // (wrong for a credit card) asset formula would have produced — liability
      // mode must reject it since real credit card balances move the other way.
      const txns = [tx("debit", 5000), tx("credit", 2000)];
      // asset formula: 1000 + 2000 - 5000 = -2000 (wrong for a credit card)
      const err = verify(txns, 1000, -2000, "liability");
      expect(err).not.toBeNull();
      expect(err!.computed).toBeCloseTo(4000);
    });

    it("matches the real HDFC credit card statement figures", () => {
      // Regression case from the actual bug: opening 301605, closing 402060,
      // credits (payments) 318768.14, debits (purchases) 419223.55.
      const txns = [tx("debit", 419223.55), tx("credit", 318768.14)];
      expect(verify(txns, 301605, 402060, "liability")).toBeNull();
    });
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
