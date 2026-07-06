import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ParsedTransaction, ParseResult, SkillTemplate } from "../../types";

interface GeminiParserInput {
  file: Buffer;
  filename: string;
  skill: SkillTemplate;
  systemPrompt: string;
}

interface GeminiResponse {
  transactions: ParsedTransaction[];
  openingBalance?: number;
  closingBalance?: number;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    openingBalance: { type: "number", nullable: true },
    closingBalance: { type: "number", nullable: true },
    transactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          description: { type: "string" },
          amount: { type: "number" },
          type: { type: "string", enum: ["debit", "credit"] },
          rowType: {
            type: "string",
            enum: ["expense", "income", "internal_transfer", "investment", "ignore"],
          },
          category: { type: "string", nullable: true },
          assetName: { type: "string", nullable: true },
          quantity: { type: "number", nullable: true },
          price: { type: "number", nullable: true },
          confidence: { type: "number" },
          source_text: { type: "string" },
        },
        required: ["date", "description", "amount", "type", "rowType", "confidence", "source_text"],
      },
    },
  },
  required: ["transactions"],
};

const RETRY_DELAYS_MS = [2000, 5000, 10000];

async function generateWithRetry(
  model: ReturnType<InstanceType<typeof GoogleGenerativeAI>["getGenerativeModel"]>,
  request: Parameters<typeof model.generateContent>[0],
): ReturnType<typeof model.generateContent> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await model.generateContent(request);
    } catch (err: unknown) {
      const is503 =
        err instanceof Error &&
        (err.message.includes("503") || err.message.includes("Service Unavailable"));
      if (is503 && attempt < RETRY_DELAYS_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

export async function parseGemini({
  file,
  skill,
  systemPrompt,
}: GeminiParserInput): Promise<ParseResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }

  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({
    model: "gemini-3-flash-preview",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA as never,
    },
  });

  const mimeType = skill.format === "pdf" ? "application/pdf" : "application/octet-stream";

  const result = await generateWithRetry(model, {
    contents: [
      {
        role: "user",
        parts: [
          { text: systemPrompt },
          { inlineData: { mimeType, data: file.toString("base64") } },
        ],
      },
    ],
  });

  const text = result.response.text();
  const parsed = JSON.parse(text) as GeminiResponse;

  return {
    transactions: parsed.transactions ?? [],
    openingBalance: parsed.openingBalance,
    closingBalance: parsed.closingBalance,
  };
}
