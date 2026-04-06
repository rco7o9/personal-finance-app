// Shared TypeScript types — mirror the shapes returned by NestJS endpoints.
// These will grow as we build out each feature module.

export type Person = {
  id: number;
  name: string;
  home_id: number;
};

export type ExpenseStatus = "pending" | "confirmed" | "edited" | "excluded";
export type InvestmentStatus = "pending" | "confirmed" | "edited" | "excluded" | "vested";
export type StatementType = "bank" | "credit_card" | "investment";
export type ExpensePriority = "necessary" | "fixed" | "variable";
