import type { ParsedTransaction, SkillTemplate, VerificationError } from "../types";

const TOLERANCE = 1.0;

export function verify(
  transactions: ParsedTransaction[],
  openingBalance: number,
  closingBalance: number,
  mode: "asset" | "liability" = "asset",
): VerificationError | null {
  // Asset accounts (bank/savings): a credit deposits money, increasing the balance
  // you hold. Liability accounts (credit card): a debit is a purchase that increases
  // what you owe, and a credit is a payment that reduces it — the mirrored sign.
  const net = transactions.reduce((sum, tx) => {
    const isIncrease = mode === "liability" ? tx.type === "debit" : tx.type === "credit";
    return isIncrease ? sum + tx.amount : sum - tx.amount;
  }, 0);

  const computed = openingBalance + net;
  const diff = computed - closingBalance;

  if (Math.abs(diff) <= TOLERANCE) {
    return null;
  }

  return { computed, expected: closingBalance, diff };
}

export function shouldSkip(skill: SkillTemplate): boolean {
  return skill.balanceCheck === "none";
}
