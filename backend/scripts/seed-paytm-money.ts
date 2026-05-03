/**
 * Parses Paytm Money trade history PDFs (Arjun + Priya) via Gemini structured output
 * and writes into staging tables.
 *
 * Approach: upload each PDF to Gemini File API → generateContent with JSON response schema →
 *   validate extracted rows → single DB transaction per run.
 *
 * Amount is already INR-denominated: amount = amount_inr (no FX conversion needed).
 *
 * Requires: GEMINI_API_KEY in backend/.env
 *
 * Idempotency: PayTM Money transactions deleted by financial_institution_id before re-inserting.
 *   Asset rows use ON CONFLICT (name) DO NOTHING — never overwrite.
 *
 * Run: cd backend && npx ts-node --project tsconfig.scripts.json scripts/seed-paytm-money.ts
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import Decimal from "decimal.js";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

// ─── Constants ───────────────────────────────────────────────────────────────

const SEED_DIR = path.join(
  __dirname,
  "../../investments_seed_data/paytm_money_trades_seed",
);

const FILES: Array<{ filename: string; person: string }> = [
  { filename: "paytm_money_trades_seed_all_time_arjun.pdf", person: "Arjun" },
  { filename: "paytm_money_trades_seed_all_time_priya.pdf", person: "Priya" },
];

const MODEL = "gemini-3-flash-preview";

const GOLD_KEYWORDS = ["gold", "sovereign gold bond"];

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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaytmTransaction {
  date: string;
  scheme_name: string;
  transaction_type: "buy" | "sell";
  units: string;
  nav: string;
  amount: string;
  person: string;
}

// ─── Pure helpers (exported for testing) ─────────────────────────────────────

export function isGoldFund(schemeName: string): boolean {
  const lower = schemeName.toLowerCase();
  return GOLD_KEYWORDS.some((kw) => lower.includes(kw));
}

export function validateRow(row: unknown): row is Omit<PaytmTransaction, "person"> {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return false;
  if (r.transaction_type !== "buy" && r.transaction_type !== "sell") return false;
  if (typeof r.scheme_name !== "string" || r.scheme_name.trim() === "") return false;
  try {
    const units = new Decimal(String(r.units));
    const nav = new Decimal(String(r.nav));
    const amount = new Decimal(String(r.amount));
    if (units.lte(0) || nav.lte(0) || amount.lte(0)) return false;
  } catch {
    return false;
  }
  return true;
}

// ─── Gemini extraction ────────────────────────────────────────────────────────

async function extractTransactions(
  ai: GoogleGenAI,
  pdfPath: string,
  person: string,
): Promise<PaytmTransaction[]> {
  console.log(`\nUploading ${path.basename(pdfPath)} to Gemini File API...`);

  const uploaded = await ai.files.upload({
    file: pdfPath,
    config: {
      mimeType: "application/pdf",
      displayName: path.basename(pdfPath),
    },
  });

  console.log(`  Uploaded: ${uploaded.uri}`);
  console.log(`  Calling ${MODEL} for structured extraction...`);

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

  const raw = JSON.parse(response.text!) as unknown[];
  const valid: PaytmTransaction[] = [];
  let skipped = 0;

  for (const row of raw) {
    if (validateRow(row)) {
      valid.push({ ...(row as Omit<PaytmTransaction, "person">), person });
    } else {
      console.warn(`  Skipping invalid row:`, JSON.stringify(row));
      skipped++;
    }
  }

  console.log(`  ${valid.length} valid rows extracted, ${skipped} skipped`);
  return valid;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in environment");

  const ai = new GoogleGenAI({ apiKey });

  // Phase 1: extract from all PDFs before touching the DB
  const allTransactions: PaytmTransaction[] = [];
  for (const { filename, person } of FILES) {
    const filePath = path.join(SEED_DIR, filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found, skipping: ${filename}`);
      continue;
    }
    const txns = await extractTransactions(ai, filePath, person);
    allTransactions.push(...txns);
  }

  if (allTransactions.length === 0) {
    console.error("No transactions extracted — aborting");
    process.exit(1);
  }

  // Phase 2: DB writes
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // Load reference IDs
    const cats = await client.query<{ id: number; name: string }>(
      "SELECT id, name FROM investment_category",
    );
    const catMap = new Map(cats.rows.map((r) => [r.name, r.id]));

    const curs = await client.query<{ id: number; code: string }>(
      "SELECT id, code FROM currency",
    );
    const curMap = new Map(curs.rows.map((r) => [r.code, r.id]));

    const fis = await client.query<{ id: number; name: string }>(
      "SELECT id, name FROM financial_institution",
    );
    const fiMap = new Map(fis.rows.map((r) => [r.name, r.id]));

    const persons = await client.query<{ id: number; name: string }>(
      "SELECT id, name FROM person",
    );
    const personMap = new Map(persons.rows.map((r) => [r.name, r.id]));

    const mfCategoryId = catMap.get("Indian Mutual Fund");
    const goldEtfCategoryId = catMap.get("Gold");
    const inrCurrencyId = curMap.get("INR");
    const paytmFinInstId = fiMap.get("PayTM Money");

    if (!mfCategoryId || !goldEtfCategoryId || !inrCurrencyId || !paytmFinInstId) {
      throw new Error(
        `Missing ref IDs: IndianMutualFund=${mfCategoryId} Gold=${goldEtfCategoryId} INR=${inrCurrencyId} PayTMMoney=${paytmFinInstId}`,
      );
    }

    await client.query("BEGIN");

    // Delete existing PayTM Money transactions (idempotency)
    const deleted = await client.query(
      `DELETE FROM investment_transaction_stage WHERE financial_institution_id = $1`,
      [paytmFinInstId],
    );
    console.log(
      `\nDeleted ${(deleted as unknown as { rowCount: number }).rowCount} existing PayTM Money transactions`,
    );

    // Upsert unique MF schemes into asset_stage
    const uniqueSchemes = [...new Set(allTransactions.map((t) => t.scheme_name))];
    const assetIdMap = new Map<string, number>();

    for (const name of uniqueSchemes) {
      const categoryId = isGoldFund(name) ? goldEtfCategoryId : mfCategoryId;
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO asset_stage (name, investment_category_id, ticker_symbol, price_source, currency_id)
         VALUES ($1, $2, NULL, 'mfapi', $3)
         ON CONFLICT (name) DO NOTHING
         RETURNING id`,
        [name, categoryId, inrCurrencyId],
      );

      if (rows.length > 0) {
        assetIdMap.set(name, rows[0].id);
        console.log(`  Inserted asset: "${name}" (${isGoldFund(name) ? "Gold" : "Indian Mutual Fund"})`);
      } else {
        // Row already existed — fetch its id
        const existing = await client.query<{ id: number }>(
          `SELECT id FROM asset_stage WHERE name = $1`,
          [name],
        );
        assetIdMap.set(name, existing.rows[0].id);
        console.log(`  Existing asset: "${name}"`);
      }
    }

    // Insert transactions
    const countByPerson = new Map<string, number>();
    for (const txn of allTransactions) {
      const personId = personMap.get(txn.person);
      if (!personId) throw new Error(`Person not found: ${txn.person}`);

      const assetId = assetIdMap.get(txn.scheme_name);
      if (!assetId) throw new Error(`Asset ID not found for scheme: ${txn.scheme_name}`);

      const qty = new Decimal(txn.units);
      const price = new Decimal(txn.nav);
      const amount = new Decimal(txn.amount);

      await client.query(
        `INSERT INTO investment_transaction_stage
           (asset_id, person_id, financial_institution_id, type,
            quantity, price, amount, currency_id, transacted_at, amount_inr)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          assetId,
          personId,
          paytmFinInstId,
          txn.transaction_type,
          qty.toFixed(8),
          price.toFixed(4),
          amount.toFixed(4),
          inrCurrencyId,
          txn.date,
          amount.toFixed(4), // already INR
        ],
      );

      countByPerson.set(txn.person, (countByPerson.get(txn.person) ?? 0) + 1);
    }

    await client.query("COMMIT");

    console.log(`\n--- Summary ---`);
    console.log(`MF schemes upserted into asset_stage: ${uniqueSchemes.length}`);
    for (const [person, count] of countByPerson) {
      console.log(`  ${person}: ${count} transactions`);
    }
    console.log(`Total inserted: ${allTransactions.length}`);
    console.log("Done.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed — rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  void run();
}
