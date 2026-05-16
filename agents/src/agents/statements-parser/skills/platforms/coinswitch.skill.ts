import type { SkillTemplate } from "../../types";

export const coinswitchSkill: SkillTemplate = {
  platformId: "coinswitch",
  displayName: "CoinSwitch",
  format: "xlsx",
  parserType: "deterministic",
  balanceCheck: "none",
  sheetName: "Spot Trades",
  // File has metadata rows; scan until the row containing "Transaction Id" to find the header
  headerSearchKey: "Transaction Id",
  columnMappings: {
    Date: "date",
    Market: "assetName",
    Volume: "quantity",
    Price: "price",
    Total: "amount",
    "Trade Type": "type",
  },
};
