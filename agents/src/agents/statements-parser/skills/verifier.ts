import type { ParsedTransaction, SkillTemplate, VerificationError } from "../types";

const TOLERANCE = 1.0;

export function verify(
  transactions: ParsedTransaction[],
  openingBalance: number,
  closingBalance: number,
): VerificationError | null {
  const net = transactions.reduce((sum, tx) => {
    return tx.type === "credit" ? sum + tx.amount : sum - tx.amount;
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
