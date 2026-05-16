import type { SkillTemplate } from "../../types";

const systemPromptTemplate = `You are a bank statement parser for ICICI Bank account statements.

Extract the opening balance, closing balance, and EVERY transaction as a separate element.

For each transaction row, extract:
- date: transaction date in YYYY-MM-DD format (format in statement may be DD/MM/YYYY or DD-Mon-YYYY)
- description: full narration/description text (Remarks or Transaction Remarks column)
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

ICICI Bank statements typically show:
- Date column: DD/MM/YYYY or DD-Mon-YYYY
- Transaction Remarks / Narration column containing UPI/NEFT/IMPS ref IDs
- Withdrawal Amt (Dr) for debits, Deposit Amt (Cr) for credits
- Balance column after each transaction

Also extract at the top level:
- openingBalance: the opening balance shown in the statement header or first row balance
- closingBalance: the closing balance shown in the statement footer or last row balance

Do NOT merge transactions. Return ALL rows found.
Do NOT return "exactly one element" — return every row as a separate element.

{{RETRY_CONTEXT}}`;

export const iciciBankSkill: SkillTemplate = {
  platformId: "icici-bank",
  displayName: "ICICI Bank",
  format: "pdf",
  parserType: "gemini",
  balanceCheck: "opening_closing",
  systemPromptTemplate,
  fewShotExamples: [
    {
      sourceText: "15/01/2024  UPI-SWIGGY-123456789-SWIGGY  500.00  -  42,350.75",
      parsed: {
        date: "2024-01-15",
        description: "UPI-SWIGGY-123456789-SWIGGY",
        amount: 500,
        type: "debit",
        rowType: "expense",
        category: "Food & Dining",
      },
    },
    {
      sourceText: "01/01/2024  SALARY CREDIT ACME CORP NEFT  85000.00  -  1,27,350.75",
      parsed: {
        date: "2024-01-01",
        description: "SALARY CREDIT ACME CORP NEFT",
        amount: 85000,
        type: "credit",
        rowType: "income",
      },
    },
  ],
};
