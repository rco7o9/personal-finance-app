import { buildSystemPrompt } from "./prompt-builder";
import type { ParsedTransaction, SkillTemplate, VerificationError } from "./types";

const skillWithTemplate: SkillTemplate = {
  platformId: "hdfc-bank",
  displayName: "HDFC Bank",
  format: "pdf",
  parserType: "gemini",
  balanceCheck: "opening_closing",
  systemPromptTemplate:
    "You are a bank statement parser.\n\nExtract all transactions.\n\n{{RETRY_CONTEXT}}",
};

const skillNoTemplate: SkillTemplate = {
  platformId: "zerodha",
  displayName: "Zerodha",
  format: "csv",
  parserType: "deterministic",
  balanceCheck: "none",
};

const sampleTx: ParsedTransaction = {
  date: "2024-01-15",
  description: "Amazon",
  amount: 500,
  type: "debit",
  rowType: "expense",
  confidence: 1.0,
  source_text: "15/01/2024 Amazon 500.00",
};

const sampleError: VerificationError = {
  computed: 9200,
  expected: 9100,
  diff: 100,
};

describe("buildSystemPrompt", () => {
  it("returns template with {{RETRY_CONTEXT}} stripped on first attempt", () => {
    const result = buildSystemPrompt(skillWithTemplate, null, null);
    expect(result).toContain("Extract all transactions");
    expect(result).not.toContain("{{RETRY_CONTEXT}}");
    expect(result).not.toContain("PREVIOUS ATTEMPT");
  });

  it("appends retry block when prior attempt and error provided", () => {
    const result = buildSystemPrompt(skillWithTemplate, [sampleTx], sampleError);
    expect(result).toContain("PREVIOUS ATTEMPT FAILED");
    expect(result).toContain("9200");
    expect(result).toContain("9100");
    expect(result).toContain("Amazon");
  });

  it("does not append retry block when only prior provided (no error)", () => {
    const result = buildSystemPrompt(skillWithTemplate, [sampleTx], null);
    expect(result).not.toContain("PREVIOUS ATTEMPT");
  });

  it("returns empty string for skill with no systemPromptTemplate", () => {
    const result = buildSystemPrompt(skillNoTemplate, null, null);
    expect(result).toBe("");
  });
});
