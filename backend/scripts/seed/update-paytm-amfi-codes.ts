/**
 * Updates ticker_symbol in asset_stage with AMFI codes for Paytm Money MF schemes.
 * Each entry uses a LIKE query to locate the row, logs what it found, then updates.
 *
 * Run: cd backend && npx ts-node --project tsconfig.scripts.json scripts/update-paytm-amfi-codes.ts
 */

import * as dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const AMFI_CODES: Array<{ pattern: string; amfi: string }> = [
  { pattern: "%Mirae Asset Large%",                            amfi: "118834" },
  { pattern: "%DSP ELSS%",                                    amfi: "119242" },
  { pattern: "%Parag Parikh Flexi Cap%",                      amfi: "122639" },
  { pattern: "%Axis Bluechip%",                               amfi: "120465" },
  { pattern: "%SBI Gold%",                                    amfi: "119788" },
  { pattern: "%Parag Parikh ELSS%",                           amfi: "147481" },
  { pattern: "%Axis ELSS%",                                   amfi: "120503" },
  { pattern: "%Tata ELSS%",                                   amfi: "132756" },
  { pattern: "%Axis Midcap%",                                 amfi: "120505" },
  { pattern: "%Kotak Gold%",                                  amfi: "119781" },
  { pattern: "%Franklin India Liquid%",                       amfi: "118577" },
];

async function run(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    console.log("Updating AMFI codes in asset_stage...\n");

    for (const { pattern, amfi } of AMFI_CODES) {
      // Step 1: find matching row(s)
      const found = await client.query<{ id: number; name: string; ticker_symbol: string | null }>(
        `SELECT id, name, ticker_symbol FROM asset_stage WHERE name ILIKE $1`,
        [pattern],
      );

      if (found.rows.length === 0) {
        console.warn(`  [${amfi}] NO MATCH for pattern: ${pattern}`);
        continue;
      }
      if (found.rows.length > 1) {
        console.warn(`  [${amfi}] MULTIPLE MATCHES for pattern: ${pattern}`);
        found.rows.forEach((r) => console.warn(`    id=${r.id} name="${r.name}"`));
        continue;
      }

      const row = found.rows[0];
      // Step 2: update by id
      await client.query(
        `UPDATE asset_stage SET ticker_symbol = $1 WHERE id = $2`,
        [amfi, row.id],
      );
      console.log(`  [${amfi}] id=${row.id}  "${row.name}"`);
    }

    console.log("\nVerification — asset_stage ticker_symbol for MF schemes:");
    const verify = await client.query<{ id: number; name: string; ticker_symbol: string | null }>(
      `SELECT id, name, ticker_symbol
       FROM asset_stage
       WHERE investment_category_id IN (
         SELECT id FROM investment_category WHERE name IN ('Indian Mutual Fund', 'Gold')
       )
       ORDER BY name`,
    );
    verify.rows.forEach((r) =>
      console.log(`  id=${r.id}  ticker=${r.ticker_symbol ?? "NULL"}  "${r.name}"`),
    );
  } finally {
    client.release();
    await pool.end();
  }
}

void run();
