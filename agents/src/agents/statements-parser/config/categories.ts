import { HOUSEHOLD } from "./household";

const BASE_EXPENSE_CATEGORIES = [
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
  "Salary",
  "Transfer",
  "Other",
];

// Household-specific categories (e.g. "<member>'s Parents' Expense") come from the
// payee rules in household.config.json, inserted before Salary/Transfer/Other.
const householdCategories = [...new Set(HOUSEHOLD.payeeRules.map((r) => r.category))].filter(
  (c) => !BASE_EXPENSE_CATEGORIES.includes(c),
);

export const EXPENSE_CATEGORIES: string[] = [
  ...BASE_EXPENSE_CATEGORIES.slice(0, -3),
  ...householdCategories,
  ...BASE_EXPENSE_CATEGORIES.slice(-3),
];

export type ExpenseCategory = string;

// The subset of EXPENSE_CATEGORIES a Gemini prompt should choose from for a
// rowType "expense" row. Excludes categories that are never Gemini's call to
// make: "Salary" only ever comes from a rowType "income" row, and "Transfer"
// is applied programmatically by statements.service.ts for internal_transfer
// rows, overriding whatever category Gemini guessed (see ADR-026).
export const EXPENSE_CLASSIFIABLE_CATEGORIES = EXPENSE_CATEGORIES.filter(
  (c) => c !== "Salary" && c !== "Transfer",
);
