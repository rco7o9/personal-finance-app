import type { SkillTemplate } from "../../types";
import { EXPENSE_CATEGORY_LIST, VENDOR_CATEGORY_GUIDANCE } from "../vendor-rules";
import {
  FAMILY_PAYEE_RULES,
  MEMBER_NAMES_SENTENCE,
  PRIMARY_MEMBER,
  SECONDARY_MEMBER,
} from "../../config/household";

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
      the statement holder (household members: ${MEMBER_NAMES_SENTENCE}).
      Match by the member's name appearing in the UPI/NEFT/IMPS narration text —
      do not try to infer this from account numbers, which you cannot see reliably.
      Example patterns: "UPI-${SECONDARY_MEMBER.statementName}...", "NEFT TO ${PRIMARY_MEMBER.statementName}...".
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

${VENDOR_CATEGORY_GUIDANCE}

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
        confidence: 0.98,
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
        confidence: 0.97,
      },
    },
    {
      sourceText: "17/01/2024  UPI-QRPYMT-882910334  180.00  -  42,170.75",
      parsed: {
        date: "2024-01-17",
        description: "UPI-QRPYMT-882910334",
        amount: 180,
        type: "debit",
        rowType: "expense",
        category: "Other",
        confidence: 0.6,
      },
    },
    {
      sourceText: "19/01/2024  BILLDESK-HDFC CREDIT CARD-XX1234  38000.00  -  4,170.75",
      parsed: {
        date: "2024-01-19",
        description: "BILLDESK-HDFC CREDIT CARD-XX1234",
        amount: 38000,
        type: "debit",
        rowType: "internal_transfer",
        transferType: "own_account",
        confidence: 0.96,
      },
    },
    {
      sourceText: `21/01/2024  UPI-${PRIMARY_MEMBER.statementName}-P0091827  8000.00  -  12,170.75`,
      parsed: {
        date: "2024-01-21",
        description: `UPI-${PRIMARY_MEMBER.statementName}-P0091827`,
        amount: 8000,
        type: "debit",
        rowType: "internal_transfer",
        transferType: "household_member",
        confidence: 0.95,
      },
    },
    {
      sourceText: "23/01/2024  ACH DEBIT-PARAG PARIKH MF SIP  15000.00  -  27,170.75",
      parsed: {
        date: "2024-01-23",
        description: "ACH DEBIT-PARAG PARIKH MF SIP",
        amount: 15000,
        type: "debit",
        rowType: "investment",
        confidence: 0.92,
      },
    },
    {
      sourceText: "25/01/2024  UPI-RAPIDO-R9182736450  120.00  -  27,050.75",
      parsed: {
        date: "2024-01-25",
        description: "UPI-RAPIDO-R9182736450",
        amount: 120,
        type: "debit",
        rowType: "expense",
        category: "Transportation",
        confidence: 0.96,
      },
    },
    {
      sourceText: "26/01/2024  UPI-JIO PREPAID RECHARGE-J8827364  399.00  -  26,651.75",
      parsed: {
        date: "2024-01-26",
        description: "UPI-JIO PREPAID RECHARGE-J8827364",
        amount: 399,
        type: "debit",
        rowType: "expense",
        category: "Utilities",
        confidence: 0.97,
      },
    },
    {
      sourceText: "28/01/2024  UPI-GREEN MEADOWS-MAINTENANCE-T2287561  4500.00  -  22,151.75",
      parsed: {
        date: "2024-01-28",
        description: "UPI-GREEN MEADOWS-MAINTENANCE-T2287561",
        amount: 4500,
        type: "debit",
        rowType: "expense",
        category: "Maintenance",
        confidence: 0.96,
      },
    },
    {
      sourceText: "29/01/2024  UPI-ZEPTO MARKETPLACE-Z6612938  650.00  -  21,501.75",
      parsed: {
        date: "2024-01-29",
        description: "UPI-ZEPTO MARKETPLACE-Z6612938",
        amount: 650,
        type: "debit",
        rowType: "expense",
        category: "Groceries",
        confidence: 0.97,
      },
    },
    ...FAMILY_PAYEE_RULES.slice(-1).map((rule) => ({
      sourceText: `30/01/2024  UPI-${rule.payees[0].toUpperCase()}-R7729183  10000.00  -  11,501.75`,
      parsed: {
        date: "2024-01-30",
        description: `UPI-${rule.payees[0].toUpperCase()}-R7729183`,
        amount: 10000,
        type: "debit" as const,
        rowType: "expense" as const,
        category: rule.category,
        confidence: 0.95,
      },
    })),
    {
      sourceText: "31/01/2024  GLOBAL BLUE REFUND-VAT REFUND  3100.00  -  14,601.75",
      parsed: {
        date: "2024-01-31",
        description: "GLOBAL BLUE REFUND-VAT REFUND",
        amount: 3100,
        type: "credit",
        rowType: "income",
        confidence: 0.94,
      },
    },
  ],
};
