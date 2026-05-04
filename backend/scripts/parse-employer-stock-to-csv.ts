/**
 * Parses all Employer stock equity PDFs via Gemini and writes rows to a CSV file for human review.
 *
 * PDF structure:
 *   purchase_1–11  : RSU release documents — "Number of Restricted Awards Disbursed",
 *                    "Release Price", "Release Date" (one transaction per PDF)
 *   purchase_12    : Stock option exercise — Exercise (ERH-*) block + Grants + Cost tables
 *   purchase_13    : ESPP — "Purchase History for Stock/Shares" table
 *   withdrawal_1–6 : Share sale blocks (identical format across all 6 PDFs)
 *
 * Output: investments_seed_data/employer_stock_parsed_transactions.csv
 *
 * After reviewing the CSV, run seed-employer-stock.ts to load into staging tables.
 *
 * Requires: GEMINI_API_KEY in backend/.env
 *
 * Run: cd backend && npx ts-node --project tsconfig.scripts.json scripts/parse-employer-stock-to-csv.ts
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import Decimal from "decimal.js";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const SEED_DIR = path.join(__dirname, "../../investments_seed_data/employer_stock_trades_seed");
const OUTPUT_CSV = path.join(
  __dirname,
  "../../investments_seed_data/employer_stock_parsed_transactions.csv",
);
const MODEL = "gemini-3-flash-preview";

// ─── Prompts ──────────────────────────────────────────────────────────────────

// PDFs 1–11: RSU release documents
// Key fields: "Number of Restricted Awards Disbursed" → quantity
//             "Release Price"                         → price per share
//             "Release Date"                          → transaction date
// amount is NOT extracted — script calculates quantity × price
const PROMPT_RSU_RELEASE = `This PDF is a Employer RSU (Restricted Stock Unit) release document.
It may contain one or more release transactions. Extract EVERY release transaction as a separate element.
Return a JSON array where each element represents one release and contains:
  - date: string in "YYYY-MM-DD" format (from "Release Date" field — convert whatever format is shown)
  - quantity: string (value from "Number of Restricted Awards Disbursed" for that release, plain integer, no commas)
  - price: string (value from "Release Price" for that release, stripped of "$", "USD", and spaces, plain decimal, no commas)
Do NOT merge multiple releases into one row. Each release date + quantity + price combination is a separate element.
Do NOT include an amount field — the script will calculate amount = quantity × price.`;

const SCHEMA_RSU_RELEASE = {
  type: "array",
  items: {
    type: "object",
    properties: {
      date: { type: "string" },
      quantity: { type: "string" },
      price: { type: "string" },
    },
    required: ["date", "quantity", "price"],
  },
};

// PDF 12: Stock option exercise — "Exercise (ERH-...)" key-value block + Grants table + Cost table
// price = Grant Price (not Fair Market Value)
// amount = Cost of Options
const PROMPT_OPTION_EXERCISE = `This PDF contains a Employer stock stock option exercise record.
Extract the transaction details from the "Exercise (ERH-...)" block, the "Grants" table,
and the "Cost" table. Return a JSON array with exactly one element containing:
  - date: string in "YYYY-MM-DD" format (from "Transaction Date" field, e.g. "02-Jun-2021" → "2021-06-02")
  - quantity: string (value from "Held Quantity" field, plain integer)
  - price: string (Grant Price from the "Grants" table, stripped of "$", "USD", and spaces, plain decimal)
  - amount: string (value from "Cost of Options" in the "Cost" table, stripped of "$", commas, "USD", and spaces, plain decimal)
IMPORTANT: Use Grant Price as the cost per share, NOT the Fair Market Value (FMV).`;

const SCHEMA_OPTION_EXERCISE = {
  type: "array",
  items: {
    type: "object",
    properties: {
      date: { type: "string" },
      quantity: { type: "string" },
      price: { type: "string" },
      amount: { type: "string" },
    },
    required: ["date", "quantity", "price", "amount"],
  },
};

// PDF 13: ESPP purchases — "Purchase History for Stock/Shares" table, Fund: Acme Corp, Inc.
// quantity = Shares Purchased (NOT Total Shares You Hold)
// amount is NOT extracted — script calculates quantity × price
const PROMPT_ESPP = `This PDF is a Employer stock ESPP (Employee Stock Purchase Plan) purchase history report.
Extract all rows from the "Purchase History for Stock/Shares" table under "Fund: Acme Corp, Inc.".
Each row represents one ESPP purchase. Return a JSON array. Each element must have:
  - date: string in "YYYY-MM-DD" format (from "Purchase Date" column, e.g. "15-Dec-2021" → "2021-12-15")
  - quantity: string (value from "Shares Purchased" column — NOT "Total Shares You Hold", plain decimal, no commas)
  - price: string (value from "Purchase Price" column, stripped of "$", "USD", and spaces, plain decimal, no commas)
Skip any header, footer, subtotal, or summary rows. Only include rows that have a Purchase Date.`;

const SCHEMA_ESPP = {
  type: "array",
  items: {
    type: "object",
    properties: {
      date: { type: "string" },
      quantity: { type: "string" },
      price: { type: "string" },
    },
    required: ["date", "quantity", "price"],
  },
};

// Withdrawal PDFs 1–6 (all identical format):
// Withdrawal on [Month DD, YYYY]
// Settlement Date: DD-Mon-YYYY
// Market Price Per Unit: $X.XX USD
// Shares Sold: NNN
// Gross Proceeds: $X,XXX.XX USD
const PROMPT_WITHDRAWAL = `This PDF contains one or more Employer stock share sale (withdrawal) records.
Each sale block follows this pattern:
  Withdrawal on [Month DD, YYYY]
  Settlement Date: DD-Mon-YYYY
  Market Price Per Unit: $X.XX USD
  Shares Sold: NNN
  Gross Proceeds: $X,XXX.XX USD
Extract all withdrawal blocks and return a JSON array. Each element must have:
  - date: string in "YYYY-MM-DD" format (from "Settlement Date" field, e.g. "23-Sep-2025" → "2025-09-23")
  - quantity: string (value from "Shares Sold", plain integer)
  - price: string (from "Market Price Per Unit", stripped of "$", "USD", and spaces, plain decimal)
  - amount: string (from "Gross Proceeds", stripped of "$", commas, "USD", and spaces, plain decimal)`;

const SCHEMA_WITHDRAWAL = {
  type: "array",
  items: {
    type: "object",
    properties: {
      date: { type: "string" },
      quantity: { type: "string" },
      price: { type: "string" },
      amount: { type: "string" },
    },
    required: ["date", "quantity", "price", "amount"],
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedRow {
  pdf_source: string;
  type: "buy" | "sell";
  transacted_at: string;
  quantity: string;
  price_usd: string;
  amount_usd: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidDate(d: unknown): boolean {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function isPositiveDecimal(s: unknown): boolean {
  try {
    return new Decimal(String(s)).gt(0);
  } catch {
    return false;
  }
}

async function callGemini(
  ai: GoogleGenAI,
  pdfPath: string,
  prompt: string,
  schema: object,
): Promise<unknown[]> {
  console.log(`  Uploading ${path.basename(pdfPath)}...`);
  const uploaded = await ai.files.upload({
    file: pdfPath,
    config: { mimeType: "application/pdf", displayName: path.basename(pdfPath) },
  });
  console.log(`  Calling ${MODEL}...`);
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { fileData: { fileUri: uploaded.uri, mimeType: "application/pdf" } },
          { text: prompt },
        ],
      },
    ],
    config: { responseMimeType: "application/json", responseSchema: schema },
  });
  return JSON.parse(response.text!) as unknown[];
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

// PDFs 1–11: RSU release — quantity × price = amount (calculated)
async function parseRsuRelease(ai: GoogleGenAI, fileNum: number): Promise<ParsedRow[]> {
  const filename = `employer_stock_seed_purchase_${fileNum}_arjun.pdf`;
  console.log(`\n=== Purchase PDF ${fileNum}: RSU Release ===`);
  const raw = await callGemini(ai, path.join(SEED_DIR, filename), PROMPT_RSU_RELEASE, SCHEMA_RSU_RELEASE);
  const rows: ParsedRow[] = [];

  for (const item of raw) {
    const r = item as Record<string, unknown>;
    if (!isValidDate(r.date) || !isPositiveDecimal(r.quantity) || !isPositiveDecimal(r.price)) {
      console.warn("  Skipping invalid row:", JSON.stringify(r));
      continue;
    }
    const qty   = new Decimal(String(r.quantity));
    const price = new Decimal(String(r.price));
    rows.push({
      pdf_source: filename,
      type: "buy",
      transacted_at: r.date as string,
      quantity: qty.toFixed(8),
      price_usd: price.toFixed(4),
      amount_usd: qty.mul(price).toFixed(4),
    });
  }

  console.log(`  Extracted: ${rows.length} RSU release row(s)`);
  return rows;
}

// PDF 12: Option exercise — amount provided directly by Gemini
async function parseOptionExercise(ai: GoogleGenAI): Promise<ParsedRow[]> {
  const filename = "employer_stock_seed_purchase_12_arjun.pdf";
  console.log("\n=== Purchase PDF 12: Option Exercise ===");
  const raw = await callGemini(ai, path.join(SEED_DIR, filename), PROMPT_OPTION_EXERCISE, SCHEMA_OPTION_EXERCISE);
  const rows: ParsedRow[] = [];

  for (const item of raw) {
    const r = item as Record<string, unknown>;
    if (
      !isValidDate(r.date) ||
      !isPositiveDecimal(r.quantity) ||
      !isPositiveDecimal(r.price) ||
      !isPositiveDecimal(r.amount)
    ) {
      console.warn("  Skipping invalid row:", JSON.stringify(r));
      continue;
    }
    rows.push({
      pdf_source: filename,
      type: "buy",
      transacted_at: r.date as string,
      quantity: new Decimal(String(r.quantity)).toFixed(8),
      price_usd: new Decimal(String(r.price)).toFixed(4),
      amount_usd: new Decimal(String(r.amount)).toFixed(4),
    });
  }

  console.log(`  Extracted: ${rows.length} option exercise row(s)`);
  return rows;
}

// PDF 13: ESPP — quantity × price = amount (calculated)
async function parseEspp(ai: GoogleGenAI): Promise<ParsedRow[]> {
  const filename = "employer_stock_seed_purchase_13_arjun.pdf";
  console.log("\n=== Purchase PDF 13: ESPP Purchases ===");
  const raw = await callGemini(ai, path.join(SEED_DIR, filename), PROMPT_ESPP, SCHEMA_ESPP);
  const rows: ParsedRow[] = [];

  for (const item of raw) {
    const r = item as Record<string, unknown>;
    if (!isValidDate(r.date) || !isPositiveDecimal(r.quantity) || !isPositiveDecimal(r.price)) {
      console.warn("  Skipping invalid row:", JSON.stringify(r));
      continue;
    }
    const qty   = new Decimal(String(r.quantity));
    const price = new Decimal(String(r.price));
    rows.push({
      pdf_source: filename,
      type: "buy",
      transacted_at: r.date as string,
      quantity: qty.toFixed(8),
      price_usd: price.toFixed(4),
      amount_usd: qty.mul(price).toFixed(4),
    });
  }

  console.log(`  Extracted: ${rows.length} ESPP purchase row(s)`);
  return rows;
}

// Withdrawal PDFs 1–6 (identical format)
async function parseWithdrawal(ai: GoogleGenAI, fileNum: number): Promise<ParsedRow[]> {
  const filename = `employer_stock_seed_withdrawal_${fileNum}_arjun.pdf`;
  console.log(`\n=== Withdrawal PDF ${fileNum} ===`);
  const raw = await callGemini(ai, path.join(SEED_DIR, filename), PROMPT_WITHDRAWAL, SCHEMA_WITHDRAWAL);
  const rows: ParsedRow[] = [];

  for (const item of raw) {
    const r = item as Record<string, unknown>;
    if (
      !isValidDate(r.date) ||
      !isPositiveDecimal(r.quantity) ||
      !isPositiveDecimal(r.price) ||
      !isPositiveDecimal(r.amount)
    ) {
      console.warn("  Skipping invalid row:", JSON.stringify(r));
      continue;
    }
    rows.push({
      pdf_source: filename,
      type: "sell",
      transacted_at: r.date as string,
      quantity: new Decimal(String(r.quantity)).toFixed(8),
      price_usd: new Decimal(String(r.price)).toFixed(4),
      amount_usd: new Decimal(String(r.amount)).toFixed(4),
    });
  }

  console.log(`  Extracted: ${rows.length} withdrawal row(s)`);
  return rows;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in environment");
  const ai = new GoogleGenAI({ apiKey });

  const rows: ParsedRow[] = [];

  // Purchases — RSU releases (PDFs 1–11, new format)
  for (let i = 1; i <= 11; i++) {
    rows.push(...(await parseRsuRelease(ai, i)));
  }

  // Purchases — option exercise (PDF 12) and ESPP (PDF 13)
  rows.push(...(await parseOptionExercise(ai)));
  rows.push(...(await parseEspp(ai)));

  // Withdrawals (PDFs 1–6, unchanged format)
  for (let i = 1; i <= 6; i++) {
    rows.push(...(await parseWithdrawal(ai, i)));
  }

  if (rows.length === 0) {
    console.error("\nNo rows extracted — check PDFs and prompts.");
    process.exit(1);
  }

  const csvLines = [
    "pdf_source,type,transacted_at,quantity,price_usd,amount_usd",
    ...rows.map((r) =>
      [r.pdf_source, r.type, r.transacted_at, r.quantity, r.price_usd, r.amount_usd].join(","),
    ),
  ];
  fs.writeFileSync(OUTPUT_CSV, csvLines.join("\n") + "\n", "utf-8");

  const buyCount  = rows.filter((r) => r.type === "buy").length;
  const sellCount = rows.filter((r) => r.type === "sell").length;
  console.log("\n--- Summary ---");
  console.log(`Buy transactions (purchases): ${buyCount}`);
  console.log(`Sell transactions (withdrawals): ${sellCount}`);
  console.log(`Total rows: ${rows.length}`);
  console.log(`\nCSV written to: ${OUTPUT_CSV}`);
  console.log("Review the CSV, then run seed-employer-stock.ts to load into staging.");
}

if (require.main === module) {
  void run();
}
