import type { SkillTemplate } from "../../types";
import { EXPENSE_CATEGORY_LIST, VENDOR_CATEGORY_GUIDANCE } from "../vendor-rules";
import { PRIMARY_MEMBER, SECONDARY_MEMBER } from "../../config/household";

const PRIMARY = PRIMARY_MEMBER.statementName;
const ADD_ON = SECONDARY_MEMBER.statementName;

const systemPromptTemplate = `You are a credit card statement parser for HDFC Bank credit card statements.

This statement covers ONE credit card account shared by a primary cardholder and an
add-on cardholder — ${PRIMARY_MEMBER.name} (primary) and ${SECONDARY_MEMBER.name} (add-on). Transactions from both
cards appear in the same statement, usually grouped under a section or header
printed with the cardholder's name (e.g. "Domestic Transactions — ${PRIMARY}" or
a per-line cardholder label). You MUST capture whose transaction each row is.

Extract the previous/opening balance, the new/closing balance, and EVERY
transaction as a separate element — both cardholders' transactions included.

For each transaction row, extract:
- date: transaction date in YYYY-MM-DD format (format in statement may be DD/MM/YYYY)
- description: full merchant/narration text
- amount: absolute value of the transaction amount (always positive)
- type: "debit" for purchases/charges, "credit" for refunds/payments received
- cardHolderName: the cardholder name printed against this transaction's section
  or line — copy it verbatim (e.g. "${PRIMARY}", "${ADD_ON}"). If the
  statement does not separate cardholders at all, omit this field rather than
  guessing.
- rowType: classify as one of:
    "expense" — purchases, merchant charges
    "income" — a refund or cashback credited back to the card (see "Refunds" below).
      This is NOT the same as a bill payment — a bill payment is
      "internal_transfer"/"own_account"; a refund is "income".
    "internal_transfer" — money movement that is NOT real household spend (see below)
    "ignore" — late fees, interest charges, GST/tax lines that are not meaningful expenses
- category: for rowType "expense" only, classify into one of:
    ${EXPENSE_CATEGORY_LIST}
- transferType: REQUIRED when rowType is "internal_transfer", omit otherwise. One of:
    "own_account" — a payment TOWARD this credit card bill from a linked account,
      or a balance transfer — not a purchase
    "household_member" — reserved for the rare case a transaction narration itself
      names a transfer to the other household member (uncommon on a CC statement,
      but classify it this way if it occurs rather than as "expense")
  ("investment_platform" transfers don't apply to a credit card statement — SIP
  debits happen on the bank account, not the card — but keep the option in mind
  if a mutual fund/broker charge appears here.)
- confidence: your genuine certainty in THIS row's extraction, 0.0–1.0. Calibrate
  per row — do not use a constant value for every row. Uncertainty about WHICH
  cardholder a transaction belongs to should also pull this down:
    0.95–1.0 — well-known merchant/pattern, unambiguous category, cardholder clearly labeled
    0.70–0.94 — recognizable but with some ambiguity (generic merchant code,
      category inferred rather than stated, cardholder attribution inferred from
      section position rather than an explicit label)
    below 0.70 — garbled/truncated text, unfamiliar merchant, ambiguous rowType or
      category, or cardholder genuinely unclear
- source_text: the verbatim row text from the statement

Also extract at the top level:
- openingBalance: the previous balance carried forward from the statement header
- closingBalance: the new/total balance due from the statement footer

Do NOT merge transactions. Return ALL rows found, for BOTH cardholders.
Do NOT return "exactly one element" — return every row as a separate element.

${VENDOR_CATEGORY_GUIDANCE}

{{RETRY_CONTEXT}}`;

export const hdfcCreditCardSkill: SkillTemplate = {
  platformId: "hdfc-credit-card",
  displayName: "HDFC Credit Card",
  format: "pdf",
  parserType: "gemini",
  // Credit card, not a deposit account: purchases (debit) increase what's owed,
  // payments (credit) decrease it — the mirror image of a bank statement. See ADR-026.
  balanceCheck: "opening_closing_liability",
  systemPromptTemplate,
  fewShotExamples: [
    {
      sourceText: `12/01/2024  AMAZON.COM*AMZN  ${PRIMARY}  2,499.00`,
      parsed: {
        date: "2024-01-12",
        description: "AMAZON.COM*AMZN",
        amount: 2499,
        type: "debit",
        rowType: "expense",
        category: "Shopping",
        cardHolderName: PRIMARY,
        confidence: 0.97,
      },
    },
    {
      sourceText: `14/01/2024  ZARA INDIA  ${ADD_ON}  4,850.00`,
      parsed: {
        date: "2024-01-14",
        description: "ZARA INDIA",
        amount: 4850,
        type: "debit",
        rowType: "expense",
        category: "Shopping",
        cardHolderName: ADD_ON,
        confidence: 0.96,
      },
    },
    {
      sourceText: `16/01/2024  POS 449182  ${PRIMARY}  650.00`,
      parsed: {
        date: "2024-01-16",
        description: "POS 449182",
        amount: 650,
        type: "debit",
        rowType: "expense",
        category: "Other",
        cardHolderName: PRIMARY,
        confidence: 0.55,
      },
    },
    {
      sourceText: "20/01/2024  PAYMENT RECEIVED - THANK YOU  45,000.00 CR",
      parsed: {
        date: "2024-01-20",
        description: "PAYMENT RECEIVED - THANK YOU",
        amount: 45000,
        type: "credit",
        rowType: "internal_transfer",
        transferType: "own_account",
        confidence: 0.98,
      },
    },
    {
      sourceText: `22/01/2024  SWIGGY  ${PRIMARY}  680.00`,
      parsed: {
        date: "2024-01-22",
        description: "SWIGGY",
        amount: 680,
        type: "debit",
        rowType: "expense",
        category: "Food & Dining",
        cardHolderName: PRIMARY,
        confidence: 0.97,
      },
    },
    {
      sourceText: `23/01/2024  UBER TRIP HELP.UBER.COM  ${ADD_ON}  310.00`,
      parsed: {
        date: "2024-01-23",
        description: "UBER TRIP HELP.UBER.COM",
        amount: 310,
        type: "debit",
        rowType: "expense",
        category: "Transportation",
        cardHolderName: ADD_ON,
        confidence: 0.97,
      },
    },
    {
      sourceText: `24/01/2024  BLINKIT  ${PRIMARY}  920.00`,
      parsed: {
        date: "2024-01-24",
        description: "BLINKIT",
        amount: 920,
        type: "debit",
        rowType: "expense",
        category: "Groceries",
        cardHolderName: PRIMARY,
        confidence: 0.97,
      },
    },
    {
      // A tax refund credited back to the card mid-statement — must NOT be
      // classified as "expense" just because most other rows on a credit card
      // statement are purchases. See "Refunds" guidance below.
      sourceText: `26/01/2024  GLOBAL BLUE REFUND  ${PRIMARY}  2,150.00 CR`,
      parsed: {
        date: "2024-01-26",
        description: "GLOBAL BLUE REFUND",
        amount: 2150,
        type: "credit",
        rowType: "income",
        cardHolderName: PRIMARY,
        confidence: 0.94,
      },
    },
  ],
};
