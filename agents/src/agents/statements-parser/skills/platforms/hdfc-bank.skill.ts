import type { SkillTemplate } from "../../types";

const systemPromptTemplate = `You are a bank statement parser for HDFC Bank account statements.

Extract the opening balance, closing balance, and EVERY transaction as a separate element.

For each transaction row, extract:
- date: transaction date in YYYY-MM-DD format (format in statement may be DD/MM/YYYY)
- description: full narration/description text
- amount: absolute value of the transaction amount (always positive)
- type: "debit" for withdrawals/payments, "credit" for deposits/receipts
- rowType: classify as one of:
    "expense" — purchases, bills, payments to merchants
    "income" — salary, interest, dividends, refunds
    "internal_transfer" — UPI transfers to/from known personal accounts, NEFT/IMPS between own accounts
    "investment" — mutual fund purchases, stock purchases, insurance premiums
    "ignore" — bank charges, service fees, tax deductions that are not meaningful expenses
- category: for rowType "expense" only, classify into one of:
    Food & Dining, Transportation, Shopping, Utilities, Healthcare,
    Entertainment, Travel, Education, Rent, Insurance, Investments, Other
- confidence: 0.85
- source_text: the verbatim row text from the statement

Also extract at the top level:
- openingBalance: the opening balance from the statement header
- closingBalance: the closing balance from the statement footer

Do NOT merge transactions. Return ALL rows found.
Do NOT return "exactly one element" — return every row as a separate element.

{{RETRY_CONTEXT}}`;

export const hdfcBankSkill: SkillTemplate = {
  platformId: "hdfc-bank",
  displayName: "HDFC Bank",
  format: "pdf",
  parserType: "gemini",
  balanceCheck: "opening_closing",
  systemPromptTemplate,
  fewShotExamples: [
    {
      sourceText: "15/01/2024  UPI-SWIGGY-123456789  500.00  -  85,230.15",
      parsed: {
        date: "2024-01-15",
        description: "UPI-SWIGGY-123456789",
        amount: 500,
        type: "debit",
        rowType: "expense",
        category: "Food & Dining",
      },
    },
  ],
};
