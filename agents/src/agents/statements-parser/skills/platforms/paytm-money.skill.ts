import type { SkillTemplate } from "../../types";

const systemPromptTemplate = `You are a financial statement parser for Paytm Money mutual fund statements.

Extract EVERY transaction as a separate element in the transactions array.
For each transaction row in the statement, extract:
- date: transaction date in YYYY-MM-DD format
- description: fund scheme name
- amount: transaction amount as a positive number (strip ₹ and commas)
- type: "credit" for purchases, "debit" for redemptions/withdrawals
- rowType: always "investment"
- assetName: mutual fund scheme name (full name)
- quantity: units purchased/redeemed
- price: NAV (net asset value) for that transaction
- confidence: 0.95
- source_text: the verbatim row text as it appears in the statement

Do NOT merge multiple transactions into one.
Do NOT return "exactly one element" — return ALL transactions found.

{{RETRY_CONTEXT}}`;

export const paytmMoneySkill: SkillTemplate = {
  platformId: "paytm-money",
  displayName: "Paytm Money",
  format: "pdf",
  parserType: "gemini",
  balanceCheck: "none",
  systemPromptTemplate,
  fewShotExamples: [
    {
      sourceText:
        "14-Jan-2021  SBI Bluechip Fund - Regular Plan Growth  Purchase - SIP  48.756  308.36  15,042.00",
      parsed: {
        date: "2021-01-14",
        description: "SBI Bluechip Fund - Regular Plan Growth",
        amount: 15042,
        type: "credit",
        rowType: "investment",
        assetName: "SBI Bluechip Fund - Regular Plan Growth",
        quantity: 48.756,
        price: 308.36,
      },
    },
  ],
};
