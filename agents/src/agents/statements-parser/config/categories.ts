export const EXPENSE_CATEGORIES = [
  "Food & Dining",
  "Transportation",
  "Shopping",
  "Groceries",
  "Utilities",
  "Healthcare",
  "Entertainment",
  "Travel",
  "Education",
  "Rent",
  "Maintenance",
  "Insurance",
  "Investments",
  "Arjun's Parents' Expense",
  "Priya's Parents' Expense",
  "Salary",
  "Transfer",
  "Other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

// The subset of EXPENSE_CATEGORIES a Gemini prompt should choose from for a
// rowType "expense" row. Excludes categories that are never Gemini's call to
// make: "Salary" only ever comes from a rowType "income" row, and "Transfer"
// is applied programmatically by statements.service.ts for internal_transfer
// rows, overriding whatever category Gemini guessed (see ADR-026).
export const EXPENSE_CLASSIFIABLE_CATEGORIES = EXPENSE_CATEGORIES.filter(
  (c) => c !== "Salary" && c !== "Transfer",
);
