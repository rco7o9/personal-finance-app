/**
 * Backfills investment_transaction.amount_inr using historical USD/INR rates
 * from Frankfurter API, then rebuilds the holding table so avg_cost and
 * total_invested are always in INR.
 *
 * Run: cd backend && npm run seed:amount-inr
 * Requires DATABASE_URL in environment (or .env).
 */

import * as dotenv from "dotenv";
import { Pool, types } from "pg";
import * as https from "https";

// Return DATE columns as plain strings (e.g. "2026-04-01") instead of JS Date objects.
// pg converts DATE to a JS Date in UTC, which shifts the date in IST (+5:30) timezones.
types.setTypeParser(1082, (val: string) => val);

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const USD_CURRENCY_ID = 2;
const INR_CURRENCY_ID = 1;
const POLITE_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${url}: ${data}`));
          } else {
            resolve(JSON.parse(data));
          }
        });
      })
      .on("error", reject);
  });
}

async function getHistoricalRate(date: string): Promise<number> {
  const url = `https://api.frankfurter.dev/v1/${date}?from=USD&to=INR`;
  const body = (await fetchJson(url)) as { rates: { INR: number } };
  const rate = body.rates.INR;
  if (!rate || typeof rate !== "number") {
    throw new Error(`Unexpected Frankfurter response for ${date}: ${JSON.stringify(body)}`);
  }
  return rate;
}

async function run(): Promise<void> {
  const client = await pool.connect();
  try {
    // 1. Fetch all unique USD transaction dates
    const datesResult = await client.query<{ transacted_at: string }>(
      `SELECT DISTINCT transacted_at FROM investment_transaction
       WHERE currency_id = $1 AND status = 'confirmed'
       ORDER BY transacted_at`,
      [USD_CURRENCY_ID],
    );
    const usdDates = datesResult.rows.map((r) => r.transacted_at);
    console.log(`Found ${usdDates.length} unique USD transaction date(s):`, usdDates);

    // 2. Fetch historical USD/INR rate for each date
    const rates = new Map<string, number>();
    for (const date of usdDates) {
      const rate = await getHistoricalRate(date);
      rates.set(date, rate);
      console.log(`  ${date}: 1 USD = ${rate} INR`);
      if (usdDates.indexOf(date) < usdDates.length - 1) {
        await sleep(POLITE_DELAY_MS);
      }
    }

    await client.query("BEGIN");

    // 3. Set amount_inr for INR transactions (1:1)
    const inrUpdate = await client.query(
      `UPDATE investment_transaction
       SET amount_inr = amount
       WHERE currency_id = $1`,
      [INR_CURRENCY_ID],
    );
    console.log(`Updated ${inrUpdate.rowCount} INR transaction(s).`);

    // 4. Set amount_inr for USD transactions (amount × historical rate)
    let usdUpdated = 0;
    for (const [date, rate] of rates) {
      const result = await client.query(
        `UPDATE investment_transaction
         SET amount_inr = amount * $1
         WHERE currency_id = $2
           AND transacted_at = $3`,
        [rate, USD_CURRENCY_ID, date],
      );
      usdUpdated += result.rowCount ?? 0;
      console.log(`  ${date}: updated ${result.rowCount} USD transaction(s) at rate ${rate}`);
    }
    console.log(`Updated ${usdUpdated} USD transaction(s) total.`);

    // 5. Verify no amount_inr is null before locking in NOT NULL
    const nullCheck = await client.query(
      `SELECT COUNT(*) AS cnt FROM investment_transaction WHERE amount_inr IS NULL`,
    );
    const nullCount = parseInt(nullCheck.rows[0].cnt as string, 10);
    if (nullCount > 0) {
      throw new Error(`${nullCount} transaction(s) still have null amount_inr — aborting.`);
    }

    // 6. Lock in NOT NULL constraint
    await client.query(
      `ALTER TABLE investment_transaction ALTER COLUMN amount_inr SET NOT NULL`,
    );
    console.log("Set amount_inr NOT NULL.");

    // 7. Rebuild holding table from amount_inr (preserves current_price from last refresh)
    await client.query(`TRUNCATE TABLE holding`);
    const insertResult = await client.query(
      `INSERT INTO holding (asset_id, quantity, avg_cost, total_invested, current_price, current_value, updated_at)
       SELECT
         it.asset_id,
         SUM(CASE WHEN it.type = 'buy' THEN it.quantity ELSE -it.quantity END)                 AS quantity,
         SUM(CASE WHEN it.type = 'buy' THEN it.amount_inr ELSE -it.amount_inr END)
           / NULLIF(SUM(CASE WHEN it.type = 'buy' THEN it.quantity ELSE -it.quantity END), 0)  AS avg_cost,
         SUM(CASE WHEN it.type = 'buy' THEN it.amount_inr ELSE -it.amount_inr END)             AS total_invested,
         NULL                                                                                    AS current_price,
         NULL                                                                                    AS current_value,
         NOW()                                                                                   AS updated_at
       FROM investment_transaction it
       WHERE it.status = 'confirmed'
       GROUP BY it.asset_id`,
    );
    console.log(`Re-seeded ${insertResult.rowCount} holding row(s).`);

    // 8. Integrity check
    const integrityCheck = await client.query(
      `SELECT a.id, a.name FROM investment_transaction it
       JOIN asset a ON a.id = it.asset_id
       LEFT JOIN holding h ON h.asset_id = a.id
       WHERE it.status = 'confirmed' AND h.asset_id IS NULL
       GROUP BY a.id, a.name`,
    );
    if (integrityCheck.rowCount && integrityCheck.rowCount > 0) {
      throw new Error(
        `Integrity check failed — assets with transactions but no holding: ${JSON.stringify(integrityCheck.rows)}`,
      );
    }

    await client.query("COMMIT");
    console.log("Done. Run POST /portfolio/holdings/refresh to repopulate current_price.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed — rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

void run();
