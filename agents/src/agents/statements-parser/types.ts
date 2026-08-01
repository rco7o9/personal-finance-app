import { Annotation } from "@langchain/langgraph";

export interface RequestMetadata {
  type: "investment" | "expense";
  platform: string;
  format: "csv" | "xlsx" | "pdf";
  personId: number;
  filename?: string;
}

export interface SkillTemplate {
  platformId: string;
  displayName: string;
  format: "csv" | "xlsx" | "pdf";
  parserType: "deterministic" | "gemini";
  columnMappings?: Record<string, string>;
  // A column name to search for to locate the header row (handles files with metadata rows before data).
  // Parser scans rows top-to-bottom until it finds a row containing this value, then treats that row as the header.
  headerSearchKey?: string;
  // XLSX-specific: which sheet to read (default: first sheet)
  sheetName?: string;
  systemPromptTemplate?: string;
  fewShotExamples?: Array<{ sourceText: string; parsed: Partial<ParsedTransaction> }>;
  balanceCheck: "opening_closing" | "running_total" | "none";
}

export interface ParsedTransaction {
  date: string;
  description: string;
  amount: number;
  type: "debit" | "credit";
  rowType: "expense" | "income" | "internal_transfer" | "investment" | "ignore";
  category?: string;
  assetName?: string;
  quantity?: number;
  price?: number;
  // Trading exchange for equity platforms (e.g. "NSE" / "BSE") — used to derive the
  // Yahoo Finance ticker suffix when a new asset is auto-created.
  exchange?: string;
  confidence: number;
  source_text: string;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  openingBalance?: number;
  closingBalance?: number;
}

export interface VerificationError {
  computed: number;
  expected: number;
  diff: number;
}

export interface GraphInput {
  file: Buffer;
  metadata: RequestMetadata;
}

export interface GraphOutput {
  status: "ok" | "error";
  verificationStatus: "passed" | "failed" | "skipped";
  attempts: number;
  transactions: ParsedTransaction[];
  openingBalance?: number;
  closingBalance?: number;
  computedBalance?: number;
  error?: string;
}

const last = <T>(a: T, b: T): T => b;

export const AgentState = Annotation.Root({
  // Required inputs — no default; must be provided to graph.invoke()
  file: Annotation<Buffer>(),
  metadata: Annotation<RequestMetadata>(),
  // Computed state — last-write-wins with sensible defaults
  skill: Annotation<SkillTemplate | null>({ reducer: last, default: () => null }),
  parsedTransactions: Annotation<ParsedTransaction[]>({ reducer: last, default: () => [] }),
  verificationStatus: Annotation<"passed" | "failed" | "skipped" | null>({
    reducer: last,
    default: () => null,
  }),
  attempts: Annotation<number>({ reducer: last, default: () => 0 }),
  verificationError: Annotation<VerificationError | null>({ reducer: last, default: () => null }),
  openingBalance: Annotation<number | null>({ reducer: last, default: () => null }),
  closingBalance: Annotation<number | null>({ reducer: last, default: () => null }),
  errorMessage: Annotation<string | null>({ reducer: last, default: () => null }),
});

export type AgentStateType = typeof AgentState.State;
export type AgentStateUpdate = typeof AgentState.Update;
