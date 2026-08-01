import type { SkillTemplate } from "../types";
import { zerodhaSkill } from "./platforms/zerodha.skill";
import { indmoneySkill } from "./platforms/indmoney.skill";
import { coinswitchSkill } from "./platforms/coinswitch.skill";
import { paytmMoneySkill } from "./platforms/paytm-money.skill";
import { employerStockSkill } from "./platforms/employer-stock.skill";
import { hdfcBankSkill } from "./platforms/hdfc-bank.skill";
import { iciciBankSkill } from "./platforms/icici-bank.skill";
import { hdfcCreditCardSkill } from "./platforms/hdfc-credit-card.skill";

export const SKILL_REGISTRY: Record<string, SkillTemplate> = {
  zerodha: zerodhaSkill,
  indmoney: indmoneySkill,
  coinswitch: coinswitchSkill,
  "paytm-money": paytmMoneySkill,
  "employer-stock": employerStockSkill,
  "hdfc-bank": hdfcBankSkill,
  "icici-bank": iciciBankSkill,
  "hdfc-credit-card": hdfcCreditCardSkill,
};

export function getSkill(platformId: string): SkillTemplate {
  const skill = SKILL_REGISTRY[platformId];
  if (!skill) {
    const supported = getSupportedPlatforms().join(", ");
    throw new Error(`No skill registered for platform "${platformId}". Supported: ${supported}`);
  }
  return skill;
}

export function getSupportedPlatforms(): string[] {
  return Object.keys(SKILL_REGISTRY);
}
