/**
 * Dry-run: extracts Paytm Money transactions via Gemini and writes to Excel for human review.
 * Does NOT write to the database.
 *
 * Output: investments_seed_data/paytm_money_trades_seed/paytm_money_review.xlsx
 * Columns: person, date, scheme_name, transaction_type, units, nav, amount, comments
 *
 * Run: cd backend && npx ts-node --project tsconfig.scripts.json scripts/parse-paytm-money-to-excel.ts
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const SEED_DIR = path.join(
  __dirname,
  "../../investments_seed_data/paytm_money_trades_seed",
);

const OUTPUT_FILE = path.join(SEED_DIR, "paytm_money_review.xlsx");

const FILES: Array<{ filename: string; person: string }> = [
  { filename: "paytm_money_trades_seed_all_time_arjun.pdf", person: "Arjun" },
  { filename: "paytm_money_trades_seed_all_time_priya.pdf", person: "Priya" },
];

const MODEL = "gemini-3-flash-preview";

const EXTRACTION_PROMPT = `Extract all investment transactions from this Paytm Money trade history PDF.
Return a JSON array. Each element must have:
  - date: string in "YYYY-MM-DD" format
  - scheme_name: string (exact mutual fund scheme name as printed in the document)
  - transaction_type: "buy" or "sell" ("Purchase - SIP" and "Purchase - Lumpsum" → "buy"; "Withdraw" → "sell")
  - units: string (plain decimal number with NO comma separators, e.g. "1984.708" not "1,984.708")
  - nav: string (Net Asset Value per unit, plain decimal with NO comma separators, e.g. "45.6789")
  - amount: string (total transaction amount in INR, plain decimal with NO comma separators, e.g. "50000.00" not "50,000.00")
Only include rows with Status = "Successful" or equivalent confirmed status.
Skip header rows, summary rows, and any row that does not have a date.
IMPORTANT: All numeric fields (units, nav, amount) must be plain decimal strings — do NOT include comma thousand separators.`;

const TRANSACTION_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      date: { type: "string" },
      scheme_name: { type: "string" },
      transaction_type: { type: "string", enum: ["buy", "sell"] },
      units: { type: "string" },
      nav: { type: "string" },
      amount: { type: "string" },
    },
    required: ["date", "scheme_name", "transaction_type", "units", "nav", "amount"],
  },
};

interface ExtractedRow {
  person: string;
  date: string;
  scheme_name: string;
  transaction_type: string;
  units: string;
  nav: string;
  amount: string;
  comments: string;
}

async function extractFromPdf(
  ai: GoogleGenAI,
  pdfPath: string,
  person: string,
): Promise<ExtractedRow[]> {
  console.log(`\nUploading ${path.basename(pdfPath)}...`);
  const uploaded = await ai.files.upload({
    file: pdfPath,
    config: { mimeType: "application/pdf", displayName: path.basename(pdfPath) },
  });
  console.log(`  Uploaded: ${uploaded.uri}`);
  console.log(`  Calling ${MODEL}...`);

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { fileData: { fileUri: uploaded.uri, mimeType: "application/pdf" } },
          { text: EXTRACTION_PROMPT },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: TRANSACTION_SCHEMA,
    },
  });

  const raw = JSON.parse(response.text!) as Record<string, string>[];
  console.log(`  ${raw.length} rows extracted`);

  return raw.map((r) => ({
    person,
    date: r.date ?? "",
    scheme_name: r.scheme_name ?? "",
    transaction_type: r.transaction_type ?? "",
    units: r.units ?? "",
    nav: r.nav ?? "",
    amount: r.amount ?? "",
    comments: "",
  }));
}

async function run(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in environment");

  const ai = new GoogleGenAI({ apiKey });

  const allRows: ExtractedRow[] = [];

  for (const { filename, person } of FILES) {
    const filePath = path.join(SEED_DIR, filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found, skipping: ${filename}`);
      continue;
    }
    const rows = await extractFromPdf(ai, filePath, person);
    allRows.push(...rows);
  }

  // Write to Excel
  const headers = ["person", "date", "scheme_name", "transaction_type", "units", "nav", "amount", "comments"];
  const wsData = [
    headers,
    ...allRows.map((r) => [r.person, r.date, r.scheme_name, r.transaction_type, r.units, r.nav, r.amount, r.comments]),
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Column widths
  ws["!cols"] = [
    { wch: 10 },  // person
    { wch: 12 },  // date
    { wch: 55 },  // scheme_name
    { wch: 16 },  // transaction_type
    { wch: 14 },  // units
    { wch: 12 },  // nav
    { wch: 14 },  // amount
    { wch: 40 },  // comments
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Transactions");
  XLSX.writeFile(wb, OUTPUT_FILE);

  console.log(`\nWrote ${allRows.length} rows to: ${OUTPUT_FILE}`);
  console.log("Open the file, add comments in the 'comments' column, and share back for prompt refinement.");
}

void run();
