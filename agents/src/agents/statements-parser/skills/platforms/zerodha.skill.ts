import type { SkillTemplate } from "../../types";

export const zerodhaSkill: SkillTemplate = {
  platformId: "zerodha",
  displayName: "Zerodha",
  format: "csv",
  parserType: "deterministic",
  balanceCheck: "none",
  columnMappings: {
    trade_date: "date",
    trade_type: "type",
    symbol: "assetName",
    isin: "description",
    quantity: "quantity",
    price: "price",
  },
};
