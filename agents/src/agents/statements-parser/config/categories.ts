export const EXPENSE_CATEGORIES = [
  "Food & Dining",
  "Transportation",
  "Shopping",
  "Utilities",
  "Healthcare",
  "Entertainment",
  "Travel",
  "Education",
  "Rent",
  "Insurance",
  "Investments",
  "Salary",
  "Transfer",
  "Other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
