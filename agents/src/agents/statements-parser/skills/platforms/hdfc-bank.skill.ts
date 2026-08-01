import type { SkillTemplate } from "../../types";
import { EXPENSE_CATEGORY_LIST, VENDOR_CATEGORY_GUIDANCE } from "../vendor-rules";

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
    "internal_transfer" — money movement that is NOT real household spend (see below)
    "investment" — mutual fund purchases, stock purchases, insurance premiums
    "ignore" — bank charges, service fees, tax deductions that are not meaningful expenses
- category: for rowType "expense" only, classify into one of:
    ${EXPENSE_CATEGORY_LIST}
- transferType: REQUIRED when rowType is "internal_transfer", omit otherwise. One of:
    "own_account" — the payment is to a credit card bill, loan EMI, or another
      account the SAME person owns. This money is not lost — it either already
      appears as itemized spend on that account's own statement (credit card) or
      is a liability payment, not a purchase.
      Recognize patterns like "CREDIT CARD PAYMENT", "AUTOPAY", "CC XXXX1234",
      "BILLDESK", card network names combined with "PAYMENT" in the narration.
    "household_member" — the counterparty is a named household member OTHER than
      the statement holder (this household has two members: Arjun and Priya).
      Match by the member's name appearing in the UPI/NEFT/IMPS narration text —
      do not try to infer this from account numbers, which you cannot see reliably.
      Example patterns: "UPI-PRIYA...", "NEFT TO ARJUN MEHTA...".
    "investment_platform" — a SIP mandate or broker debit going to a known
      investment platform or AMC (e.g. Zerodha, mutual fund house names, "SIP",
      "ACH DEBIT" toward a fund house). This spend is already captured through the
      investment statement for that platform — do not tag it "expense".
- confidence: your genuine certainty in THIS row's extraction, 0.0–1.0. Calibrate
  per row — do not use a constant value for every row:
    0.95–1.0 — well-known merchant/pattern, unambiguous category and rowType
    0.70–0.94 — recognizable but with some ambiguity (generic UPI narration,
      category inferred rather than stated outright, uncertain cardholder or
      transfer classification)
    below 0.70 — garbled/truncated text, unfamiliar merchant, or genuinely
      ambiguous rowType/category/transferType
- source_text: the verbatim row text from the statement

Also extract at the top level:
- openingBalance: the opening balance from the statement header
- closingBalance: the closing balance from the statement footer

Do NOT merge transactions. Return ALL rows found.
Do NOT return "exactly one element" — return every row as a separate element.

${VENDOR_CATEGORY_GUIDANCE}

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
        confidence: 0.98,
      },
    },
    {
      sourceText: "18/01/2024  UPI-XYZTRADERS-9182736  240.00  -  84,990.15",
      parsed: {
        date: "2024-01-18",
        description: "UPI-XYZTRADERS-9182736",
        amount: 240,
        type: "debit",
        rowType: "expense",
        category: "Other",
        confidence: 0.62,
      },
    },
    {
      sourceText: "20/01/2024  HDFC CREDIT CARD PAYMENT-AUTOPAY  45000.00  -  39,990.15",
      parsed: {
        date: "2024-01-20",
        description: "HDFC CREDIT CARD PAYMENT-AUTOPAY",
        amount: 45000,
        type: "debit",
        rowType: "internal_transfer",
        transferType: "own_account",
        confidence: 0.97,
      },
    },
    {
      sourceText: "22/01/2024  UPI-PRIYA MEHTA-Q3487561  12000.00  -  27,990.15",
      parsed: {
        date: "2024-01-22",
        description: "UPI-PRIYA MEHTA-Q3487561",
        amount: 12000,
        type: "debit",
        rowType: "internal_transfer",
        transferType: "household_member",
        confidence: 0.95,
      },
    },
    {
      sourceText: "25/01/2024  ACH DEBIT-ZERODHA BROKING SIP  10000.00  -  17,990.15",
      parsed: {
        date: "2024-01-25",
        description: "ACH DEBIT-ZERODHA BROKING SIP",
        amount: 10000,
        type: "debit",
        rowType: "investment",
        confidence: 0.93,
      },
    },
    {
      sourceText: "27/01/2024  UPI-UBER INDIA SYSTEMS-P8827364  350.00  -  17,640.15",
      parsed: {
        date: "2024-01-27",
        description: "UPI-UBER INDIA SYSTEMS-P8827364",
        amount: 350,
        type: "debit",
        rowType: "expense",
        category: "Transportation",
        confidence: 0.97,
      },
    },
    {
      sourceText: "28/01/2024  UPI-AIRTEL PAYMENTS BANK-BharatBill  699.00  -  16,941.15",
      parsed: {
        date: "2024-01-28",
        description: "UPI-AIRTEL PAYMENTS BANK-BharatBill",
        amount: 699,
        type: "debit",
        rowType: "expense",
        category: "Utilities",
        confidence: 0.96,
      },
    },
    {
      sourceText: "01/02/2024  UPI-VIKRAM RAO-R7729183  35000.00  -  56,441.15",
      parsed: {
        date: "2024-02-01",
        description: "UPI-VIKRAM RAO-R7729183",
        amount: 35000,
        type: "debit",
        rowType: "expense",
        category: "Rent",
        confidence: 0.96,
      },
    },
    {
      sourceText: "02/02/2024  UPI-MYGATE-COMMUNITY-M4419273  2500.00  -  53,941.15",
      parsed: {
        date: "2024-02-02",
        description: "UPI-MYGATE-COMMUNITY-M4419273",
        amount: 2500,
        type: "debit",
        rowType: "expense",
        category: "Maintenance",
        confidence: 0.95,
      },
    },
    {
      sourceText: "03/02/2024  UPI-BLINKIT-9182736451  840.00  -  53,101.15",
      parsed: {
        date: "2024-02-03",
        description: "UPI-BLINKIT-9182736451",
        amount: 840,
        type: "debit",
        rowType: "expense",
        category: "Groceries",
        confidence: 0.97,
      },
    },
    {
      sourceText: "04/02/2024  UPI-SUNITA MEHTA-S6612938  15000.00  -  38,101.15",
      parsed: {
        date: "2024-02-04",
        description: "UPI-SUNITA MEHTA-S6612938",
        amount: 15000,
        type: "debit",
        rowType: "expense",
        category: "Arjun's Parents' Expense",
        confidence: 0.95,
      },
    },
    {
      sourceText: "05/02/2024  UPI-RAJESH KAPOOR-D2287561  10000.00  -  28,101.15",
      parsed: {
        date: "2024-02-05",
        description: "UPI-RAJESH KAPOOR-D2287561",
        amount: 10000,
        type: "debit",
        rowType: "expense",
        category: "Priya's Parents' Expense",
        confidence: 0.95,
      },
    },
    {
      sourceText: "06/02/2024  GLOBAL BLUE REFUND-TAX REFUND  4200.00  +  32,301.15",
      parsed: {
        date: "2024-02-06",
        description: "GLOBAL BLUE REFUND-TAX REFUND",
        amount: 4200,
        type: "credit",
        rowType: "income",
        confidence: 0.94,
      },
    },
  ],
};
