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

export type PortfolioSummary = {
  totalValue: string;
  expectedTotalValue: string;
  plannedInvestments: string;
  targetEndDate: string | null;
  overallXirr: string | null;
  byAssetClass: AssetClassSummary[];
  byPlatform: PlatformSummary[];
  rebalancingSuggestions: RebalancingSuggestion[];
};

export type AssetClassSummary = {
  categoryId: number;
  assetClass: string;
  value: string;
  percentage: string; // current_value / expectedTotal — compares to target at end_date
  targetPercentage: string | null;
  targetAbsoluteValue: string | null; // targetPct × expectedTotal in INR
  delta: string | null;
  xirr: string | null;
};

export type PlatformSummary = {
  platform: string;
  assetClass: string;
  value: string;
};

export type RebalancingSuggestion = {
  tag: "overweight" | "underweight";
  assetClass: string;
  actualPct: string;
  targetPct: string;
  message: string;
  rupeesGap: string | null; // targetAbsoluteValue − currentValue; negative means overweight
};

export type PortfolioAsset = {
  id: number;
  name: string;
  assetClass: string;
  platform: string;
};

export type LotEntry = {
  id: number;
  date: string;
  type: string;
  units: string;
  buyPrice: string;
  cost: string;
  costNative: string | null;
  currentValue: string | null;
  currentValueNative: string | null;
  xirr: string | null;
};

export type PendingTransaction = {
  id: number;
  date: string;
  assetName: string;
  platform: string;
  categoryName: string;
  quantity: string | null;
  price: string | null;
  nativeCurrency: string | null;
  amountInr: string;
  status: "pending" | "confirmed";
  confidenceScore: string | null;
  verificationStatus: "passed" | "failed" | "skipped" | null;
  personName: string;
};

export type UploadResponse = {
  inserted: number;
  autoApproved: number;
  needsReview: number;
  skipped: number;
  verificationStatus: "passed" | "failed" | "skipped";
  transactions: PendingTransaction[];
};

export type ExpenseCategorySummary = {
  categoryId: number;
  categoryName: string;
  total: string;
  transactionCount: number;
  percentage: string;
};

export type ExpenseSummary = {
  totalSpend: string;
  transactionCount: number;
  categories: ExpenseCategorySummary[];
};

export type ExpenseDetailRow = {
  id: number;
  date: string;
  description: string;
  amount: string;
};

export type AssetDetail = {
  assetName: string;
  currentValue: string | null;
  totalUnits: string;
  avgCost: string;
  unrealisedGain: string | null;
  absoluteReturnPct: string | null;
  xirr: string | null;
  nativeCurrency: string | null;
  nativeAvgCost: string | null;
  nativeTotalInvested: string | null;
  currentPriceNative: string | null;
  currentValueNative: string | null;
  lots: LotEntry[];
};
