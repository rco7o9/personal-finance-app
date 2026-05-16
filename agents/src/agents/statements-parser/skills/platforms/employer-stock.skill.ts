import type { SkillTemplate } from "../../types";

const systemPromptTemplate = `You are a financial statement parser for Employer RSU, ESPP, and stock option documents.

Extract EVERY transaction as a separate element in the transactions array.
These documents may contain RSU vesting events, option exercises, ESPP purchases, or stock sale/withdrawal records.

For each transaction, extract:
- date: transaction/release/settlement date in YYYY-MM-DD format
- description: brief description (e.g. "RSU Release", "Option Exercise", "ESPP Purchase", "Stock Sale")
- amount: total value in USD as a positive number (quantity × price for RSU/ESPP; extracted directly for sales)
- type: "credit" for acquisitions (RSU, ESPP, option exercise), "debit" for sales/withdrawals
- rowType: always "investment"
- assetName: "Acme Corp, Inc."
- quantity: number of shares
- price: price per share in USD
  - For RSU releases: use the Release Price (not FMV)
  - For option exercises: use the Grant Price (not FMV)
  - For ESPP: use the purchase price
  - For sales: use the actual sale price
- confidence: 0.9
- source_text: verbatim text of the row/section from the document

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
        "Release Date: 09/15/2022  Number of Restricted Awards Disbursed: 500  Release Price: $12.50",
      parsed: {
        date: "2022-09-15",
        description: "RSU Release",
        amount: 6250,
        type: "credit",
        rowType: "investment",
        assetName: "Acme Corp, Inc.",
        quantity: 500,
        price: 12.5,
      },
    },
  ],
};
