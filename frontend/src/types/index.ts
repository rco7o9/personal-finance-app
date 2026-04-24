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
  byAssetClass: AssetClassSummary[];
  byPlatform: PlatformSummary[];
  rebalancingSuggestions: RebalancingSuggestion[];
};

export type AssetClassSummary = {
  categoryId: number;
  assetClass: string;
  value: string;
  percentage: string;
  targetPercentage: string | null;
  delta: string | null;
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
  currentValue: string | null;
  xirr: null;
};

export type AssetDetail = {
  assetName: string;
  currentValue: string | null;
  totalUnits: string;
  avgCost: string;
  unrealisedGain: string | null;
  absoluteReturnPct: string | null;
  xirr: null;
  lots: LotEntry[];
};
