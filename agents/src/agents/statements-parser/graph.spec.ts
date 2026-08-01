import { runGraph } from "./graph";
import type { GraphInput } from "./types";

// Mock parsers so no real API calls happen
jest.mock("./skills/parsers/csv.parser", () => ({
  parseCsv: jest.fn().mockReturnValue({
    transactions: [
      {
        date: "2024-01-10",
        description: "INFY",
        amount: 17005,
        type: "credit",
        rowType: "investment",
        assetName: "INFY",
        quantity: 10,
        price: 1700.5,
        confidence: 1.0,
        source_text: "2024-01-10,INFY,BUY,10,1700.50,17005.00",
      },
    ],
  }),
}));

jest.mock("./skills/parsers/gemini.parser", () => ({
  parseGemini: jest.fn(),
}));

const CSV_CONTENT = Buffer.from(
  "trade_date,tradingsymbol,trade_type,quantity,price,amount\n2024-01-10,INFY,BUY,10,1700.50,17005.00",
);

describe("runGraph — known deterministic platform", () => {
  it("returns status ok, skipped verification, and transactions", async () => {
    const input: GraphInput = {
      file: CSV_CONTENT,
      metadata: { type: "investment", platform: "zerodha", format: "csv", personId: 1 },
    };

    const output = await runGraph(input);

    expect(output.status).toBe("ok");
    expect(output.verificationStatus).toBe("skipped");
    expect(output.attempts).toBe(1);
    expect(output.transactions).toHaveLength(1);
    expect(output.transactions[0].assetName).toBe("INFY");
  });
});

describe("runGraph — unknown platform", () => {
  it("returns status error with supported platforms message", async () => {
    const input: GraphInput = {
      file: CSV_CONTENT,
      metadata: { type: "investment", platform: "groww", format: "csv", personId: 1 },
    };

    const output = await runGraph(input);

    expect(output.status).toBe("error");
    expect(output.error).toContain('No skill registered for platform "groww"');
    expect(output.error).toContain("Supported:");
    expect(output.transactions).toHaveLength(0);
  });
});

describe("runGraph — gemini platform with verifier failure", () => {
  beforeEach(() => {
    const { parseGemini } = require("./skills/parsers/gemini.parser");
    process.env.GEMINI_API_KEY = "test-key";

    // Always return wrong balance so verifier fails all 3 times
    parseGemini.mockResolvedValue({
      transactions: [{ date: "2024-01-15", description: "Swiggy", amount: 500, type: "debit",
        rowType: "expense", confidence: 0.9, source_text: "row" }],
      openingBalance: 10000,
      closingBalance: 9000, // computed = 9500, expected = 9000 → diff = 500, fails
    });
  });

  it("retries 3 times then returns failed verification status", async () => {
    const input: GraphInput = {
      file: Buffer.from("%PDF-1.4"),
      metadata: { type: "expense", platform: "hdfc-bank", format: "pdf", personId: 1 },
    };

    const output = await runGraph(input);

    expect(output.status).toBe("ok");
    expect(output.verificationStatus).toBe("failed");
    expect(output.attempts).toBe(3);
  });
});

describe("runGraph — gemini returns nothing at all", () => {
  it("does not report a false 'passed' when Gemini returns zero transactions and no balances", async () => {
    // Regression test: Gemini occasionally returns an effectively empty parse
    // (no transactions, no balances). Defaulting missing balances to 0 made
    // `verify()` trivially pass (0 ≈ 0), silently reporting success on a
    // statement that was never actually read.
    const { parseGemini } = require("./skills/parsers/gemini.parser");
    process.env.GEMINI_API_KEY = "test-key";
    parseGemini.mockResolvedValue({ transactions: [] });

    const input: GraphInput = {
      file: Buffer.from("%PDF-1.4"),
      metadata: { type: "expense", platform: "hdfc-bank", format: "pdf", personId: 1 },
    };

    const output = await runGraph(input);

    expect(output.verificationStatus).not.toBe("passed");
    expect(output.verificationStatus).toBe("failed");
    expect(output.attempts).toBe(3);
    expect(output.transactions).toHaveLength(0);
  });
});
