import type { SkillTemplate } from "../../types";

const systemPromptTemplate = `You are a financial statement parser for Employer RSU, ESPP, and stock option documents.

Extract EVERY transaction as a separate element in the transactions array.
These documents may contain RSU vesting events, option exercises, ESPP purchases, or stock sale/withdrawal records.

For each transaction, extract:
- date: transaction/release/settlement date in YYYY-MM-DD format
- description: brief description (e.g. "RSU Release", "Option Exercise", "ESPP Purchase", "Stock Sale")
- amount: total USD value as a positive number — see rules below
- type: "credit" for acquisitions (RSU, ESPP, option exercise), "debit" for sales/withdrawals
- rowType: always "investment"
- assetName: "Acme Corp, Inc."
- quantity: number of shares — see rules below
- price: price per share in USD — see rules below
- confidence: 0.9
- source_text: verbatim text of the row/section from the document

Field rules by document type:

RSU Release documents (contain "Number of Restricted Awards Released/Sold/Disbursed" and "Gross Release Value"):
  - quantity: use ONLY "Number of Restricted Awards Disbursed" (NOT "Quantity Released" or "Number of Restricted Awards Released")
  - price: use the "Release Price"
  - amount: "Gross Release Value" MINUS the "Total Value" from the "Value of Shares Sold" section
    (this gives the net USD value of the shares actually received after tax withholding)

Option exercise documents:
  - quantity: "Held Quantity" (shares kept)
  - price: Grant Price (NOT Fair Market Value)
  - amount: "Cost of Options" from the Cost table

ESPP documents:
  - quantity: "Shares Purchased"
  - price: Purchase Price
  - amount: quantity × price

Sale/withdrawal documents:
  - quantity: "Shares Sold"
  - price: "Market Price Per Unit"
  - amount: "Gross Proceeds"

Do NOT merge multiple transactions into one element.
Do NOT return "exactly one element" — return ALL transactions found.
Multiple withdrawal records within a single PDF must each be a separate element.

{{RETRY_CONTEXT}}`;

export const employerStockSkill: SkillTemplate = {
  platformId: "employer-stock",
  displayName: "Employer RSU",
  format: "pdf",
  parserType: "gemini",
  balanceCheck: "none",
  systemPromptTemplate,
  fewShotExamples: [
    {
      sourceText:
        "Release Date: 15-Sep-2025  Release Price: $7.80 USD  Quantity Released: 3,112  " +
        "Number of Restricted Awards Released: 3,112  Number of Restricted Awards Sold: 1,325  " +
        "Number of Restricted Awards Disbursed: 1,787  Gross Release Value: $24,273.60 USD  " +
        "Value of Shares Sold — Total Value: $10,384.46 USD",
      parsed: {
        date: "2025-09-15",
        description: "RSU Release",
        // amount = Gross Release Value ($24,273.60) - Total Value of Shares Sold ($10,384.46)
        amount: 13889.14,
        type: "credit",
        rowType: "investment",
        assetName: "Acme Corp, Inc.",
        // quantity = Number of Restricted Awards Disbursed (NOT Quantity Released)
        quantity: 1787,
        price: 7.8,
      },
    },
  ],
};
