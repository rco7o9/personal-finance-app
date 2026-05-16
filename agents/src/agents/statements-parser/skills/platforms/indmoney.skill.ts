import type { SkillTemplate } from "../../types";

export const indmoneySkill: SkillTemplate = {
  platformId: "indmoney",
  displayName: "INDMoney",
  format: "xlsx",
  parserType: "deterministic",
  balanceCheck: "none",
  // File has metadata rows; scan until the row containing "Stock Name" to find the header
  headerSearchKey: "Stock Name",
  columnMappings: {
    "Stock Name": "assetName",
    "Stock Symbol": "description",
    "Order Execution Time": "date",
    "Transaction Type": "type",
    Quantity: "quantity",
    "Price ($)": "price",
    "Order Amount ($)": "amount",
  },
};
