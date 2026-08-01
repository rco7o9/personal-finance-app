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

const RETRY_DELAYS_MS = [2000, 5000, 10000];

// The SDK has no default request timeout — a stalled connection would otherwise
// hang this call (and the synchronous backend→agent→frontend chain behind it,
// per ADR-024) forever instead of surfacing an error the retry loop can act on.
// A real multi-cardholder HDFC CC statement (many transactions, each requiring a
// verbatim source_text field) measured well over 150s to generate — 150s was too
// tight and turned a legitimately-slow-but-working call into a false timeout.
const REQUEST_TIMEOUT_MS = 280_000;

async function generateWithRetry(
  model: ReturnType<InstanceType<typeof GoogleGenerativeAI>["getGenerativeModel"]>,
  request: Parameters<typeof model.generateContent>[0],
): ReturnType<typeof model.generateContent> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await model.generateContent(request, { timeout: REQUEST_TIMEOUT_MS });
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
      // responseSchema deliberately omitted: verified against a real 111-transaction
      // HDFC credit card statement that constraining gemini-3-flash-preview with a
      // responseSchema for this shape produces malformed, unparseable JSON (breaks
      // partway through the transactions array) — while the identical prompt without
      // a schema returns clean, valid JSON matching it anyway. The system prompt
      // already enumerates every field/type/enum exhaustively, so schema enforcement
      // here is redundant with the prompt and actively harmful for this model.
      responseMimeType: "application/json",
      // Without an explicit cap, long statements (100+ transactions, each with a
      // verbatim source_text field) can hit the model's default output budget and
      // get cut off mid-JSON, which fails JSON.parse entirely. Set a high explicit
      // ceiling so real-world statement lengths don't get truncated.
      maxOutputTokens: 65536,
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
