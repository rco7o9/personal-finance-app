import { EXPENSE_CLASSIFIABLE_CATEGORIES } from "../config/categories";

// Single source of truth for the category enum line embedded in every expense
// parsing prompt (hdfc-bank, icici-bank, hdfc-credit-card) — keeps the three
// prompts from drifting out of sync with each other or with config/categories.ts.
export const EXPENSE_CATEGORY_LIST = EXPENSE_CLASSIFIABLE_CATEGORIES.join(", ");

// Household-specific vendor/merchant and named-payee categorization rules, shared
// verbatim across every expense-parsing skill (bank and credit card alike) so the
// same transaction is categorized the same way regardless of which statement it's
// read from. Named-payee rules (Rent/Maintenance/parents' expense categories) are
// primarily bank-statement patterns (UPI/NEFT to an individual) but are kept in
// the shared block rather than split out — harmless to include on a credit card
// statement where they simply won't match anything.
export const VENDOR_CATEGORY_GUIDANCE = `Household vendor/merchant categorization rules — apply these whenever the
narration matches, in preference to guessing from a generic UPI/POS reference
number alone:
  - Zomato, Swiggy, or a restaurant/eatery name appearing directly → "Food & Dining"
  - Uber, Rapido, or Green SM → "Transportation" (cab/ride-hailing)
  - Any "HDFC Prepaid Card" load or spend entry → "Travel"
  - Airtel or Jio → "Utilities"
  - Amazon, Myntra, Nykaa, or another recognizable online or offline retail store → "Shopping"
  - Zepto, Blinkit, Instamart, or Handpickd → "Groceries"
  - A transfer/UPI/NEFT/IMPS to "Vikram Rao" → "Rent". Classify this as rowType
    "expense" with category "Rent" — do NOT tag it "internal_transfer" /
    "household_member"; Vikram Rao is a landlord, not a household member.
  - A transfer/UPI/NEFT/IMPS to "Green Meadows Residency" or "MyGate" → "Maintenance"
    (rowType "expense")
  - A transfer/UPI/NEFT/IMPS to "Sunita Mehta" → category "Arjun's Parents' Expense"
    (rowType "expense"). Do NOT tag it "internal_transfer" / "household_member" —
    Sunita Mehta is Arjun's parent, not a household member.
  - A transfer/UPI/NEFT/IMPS to "Rajesh Kapoor" or "Neeta Kapoor" → category
    "Priya's Parents' Expense" (rowType "expense"), for the same reason —
    Priya's parents, not a household member.

Refunds: a transaction whose narration contains "REFUND" (e.g. "GLOBAL BLUE
REFUND") is money credited BACK to the account or card, not new spend — even
when it appears in the middle of a statement full of purchases. Classify it as
rowType "income" with type "credit", never as rowType "expense", regardless of
which merchant issued it or how the surrounding rows are classified.

Categorization discipline — do not hallucinate: only apply one of the vendor
rules above, or any other specific category, when you genuinely recognize the
merchant or the narration text clearly states the nature of the spend. If the
merchant is unfamiliar or the description is too generic or garbled to tell
(e.g. a bare UPI reference number with no merchant name), classify the category
as "Other" and lower the confidence score accordingly (below 0.70) instead of
guessing a specific-sounding category. A wrong specific category is worse than
an honest "Other" — it silently corrupts the category breakdown instead of
visibly flagging itself for review.`;
