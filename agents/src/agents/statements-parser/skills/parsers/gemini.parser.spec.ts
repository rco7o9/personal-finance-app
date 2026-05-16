import { parseGemini } from "./gemini.parser";
import { hdfcBankSkill } from "../platforms/hdfc-bank.skill";

// Mock the @google/generative-ai module
jest.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: jest.fn().mockReturnValue({
        generateContent: jest.fn(),
      }),
    })),
  };
});

const mockResponse = {
  openingBalance: 10000,
  closingBalance: 9500,
  transactions: [
    {
      date: "2024-01-15",
      description: "Swiggy",
      amount: 500,
      type: "debit",
      rowType: "expense",
      category: "Food & Dining",
      confidence: 0.9,
      source_text: "15/01/2024  UPI-SWIGGY  500.00",
    },
  ],
};

describe("parseGemini", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-api-key";
    jest.clearAllMocks();
  });

  it("throws if GEMINI_API_KEY is not set", async () => {
    delete process.env.GEMINI_API_KEY;
    const file = Buffer.from("%PDF-1.4");
    await expect(
      parseGemini({ file, filename: "test.pdf", skill: hdfcBankSkill, systemPrompt: "prompt" }),
    ).rejects.toThrow("GEMINI_API_KEY");
  });

  it("returns transactions and balances from Gemini response", async () => {
    // Re-import after mock is set up
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const mockGenerate = jest.fn().mockResolvedValue({
      response: { text: () => JSON.stringify(mockResponse) },
    });
    GoogleGenerativeAI.mockImplementation(() => ({
      getGenerativeModel: jest.fn().mockReturnValue({ generateContent: mockGenerate }),
    }));

    const file = Buffer.from("%PDF-1.4");
    const result = await parseGemini({
      file,
      filename: "hdfc.pdf",
      skill: hdfcBankSkill,
      systemPrompt: "extract transactions",
    });

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].description).toBe("Swiggy");
    expect(result.openingBalance).toBe(10000);
    expect(result.closingBalance).toBe(9500);
  });

  it("returns empty transactions array when Gemini returns empty list", async () => {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const mockGenerate = jest.fn().mockResolvedValue({
      response: { text: () => JSON.stringify({ transactions: [] }) },
    });
    GoogleGenerativeAI.mockImplementation(() => ({
      getGenerativeModel: jest.fn().mockReturnValue({ generateContent: mockGenerate }),
    }));

    const file = Buffer.from("%PDF-1.4");
    const result = await parseGemini({
      file,
      filename: "hdfc.pdf",
      skill: hdfcBankSkill,
      systemPrompt: "extract",
    });

    expect(result.transactions).toHaveLength(0);
  });
});
