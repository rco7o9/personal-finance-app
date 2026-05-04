/**
 * Promotes all staged investment data from staging tables into production.
 *
 * Steps:
 *   1. Create backup tables (asset_stage_bak, investment_transaction_stage_bak, holding_stage_bak)
 *      — created outside the main transaction so they survive a rollback.
 *   2. In a single transaction:
 *      a. DELETE production holding, investment_transaction, asset (reverse FK order)
 *      b. INSERT asset_stage → asset
 *         — new SERIAL PKs assigned; price_source TEXT cast to enum (mfapi → amfi)
 *      c. INSERT investment_transaction_stage → investment_transaction
 *         — asset_id remapped: asset_stage.id → asset.id via JOIN on asset.name
 *      d. INSERT holding_stage → holding
 *         — asset_id remapped the same way
 *   3. Print per-platform transaction counts for verification.
 *
 * Backup tables are kept for CloudBeaver review and must be dropped manually.
 *
 * Run: cd backend && npx ts-node --project tsconfig.scripts.json scripts/promote-seed.ts
 */

import * as dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

async function run(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // ─── Step 1: Backup staging tables (autocommit — survives main tx rollback) ──

    console.log("Creating backup tables (skipped if already exist)...");

    await client.query(`
      CREATE TABLE IF NOT EXISTS asset_stage_bak
        AS SELECT * FROM asset_stage
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS investment_transaction_stage_bak
        AS SELECT * FROM investment_transaction_stage
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS holding_stage_bak
        AS SELECT * FROM holding_stage
    `);

    const ab = await client.query<{ count: string }>("SELECT COUNT(*) FROM asset_stage_bak");
    const tb = await client.query<{ count: string }>(
      "SELECT COUNT(*) FROM investment_transaction_stage_bak",
    );
    const hb = await client.query<{ count: string }>("SELECT COUNT(*) FROM holding_stage_bak");
    console.log(
      `Backup counts — assets: ${ab.rows[0].count}, ` +
        `transactions: ${tb.rows[0].count}, holdings: ${hb.rows[0].count}`,
    );

    // ─── Step 2: Promote inside a single transaction ──────────────────────────

    console.log("\nStarting promotion transaction...");
    await client.query("BEGIN");

    // 2a. Clear production tables in reverse FK order
    const delHolding = await client.query("DELETE FROM holding");
    const delTxn = await client.query("DELETE FROM investment_transaction");
    const delAsset = await client.query("DELETE FROM asset");
    console.log(
      `Cleared — holding: ${delHolding.rowCount ?? 0}, ` +
        `investment_transaction: ${delTxn.rowCount ?? 0}, ` +
        `asset: ${delAsset.rowCount ?? 0}`,
    );

    // 2b. Insert assets — new SERIAL ids assigned
    // price_source is TEXT in staging; cast to enum, remapping 'mfapi' → 'amfi'
    const insAsset = await client.query(`
      INSERT INTO asset
        (name, investment_category_id, ticker_symbol, exchange,
         price_source, currency_id, subcategory)
      SELECT
        name,
        investment_category_id,
        ticker_symbol,
        exchange,
        CASE WHEN price_source = 'mfapi' THEN 'amfi' ELSE price_source END::price_source,
        currency_id,
        subcategory
      FROM asset_stage
      ORDER BY id
    `);
    console.log(`Inserted ${insAsset.rowCount ?? 0} assets`);

    // 2c. Insert investment transactions — remap asset_id via name join
    const insTxn = await client.query(`
      INSERT INTO investment_transaction
        (asset_id, person_id, financial_institution_id, investment_statement_id,
         type, quantity, price, amount, currency_id,
         transacted_at, status, is_seed, source, notes, created_at, amount_inr)
      SELECT
        a.id,
        its.person_id,
        its.financial_institution_id,
        NULL,
        its.type::investment_transaction_type,
        its.quantity,
        its.price,
        its.amount,
        its.currency_id,
        its.transacted_at,
        its.status::transaction_status,
        its.is_seed,
        its.source::investment_transaction_source,
        its.notes,
        its.created_at,
        its.amount_inr
      FROM investment_transaction_stage its
      JOIN asset_stage  ast ON ast.id   = its.asset_id
      JOIN asset        a   ON a.name   = ast.name
      ORDER BY its.id
    `);
    console.log(`Inserted ${insTxn.rowCount ?? 0} investment transactions`);

    // 2d. Insert holdings — remap asset_id via name join
    const insHolding = await client.query(`
      INSERT INTO holding
        (asset_id, quantity, avg_cost, total_invested,
         current_price, current_value, updated_at,
         native_currency, native_avg_cost, native_total_invested,
         current_price_native, current_value_native)
      SELECT
        a.id,
        hs.quantity,
        hs.avg_cost,
        hs.total_invested,
        hs.current_price,
        hs.current_value,
        hs.updated_at,
        hs.native_currency,
        hs.native_avg_cost,
        hs.native_total_invested,
        hs.current_price_native,
        hs.current_value_native
      FROM holding_stage hs
      JOIN asset_stage  ast ON ast.id   = hs.asset_id
      JOIN asset        a   ON a.name   = ast.name
      ORDER BY hs.id
    `);
    console.log(`Inserted ${insHolding.rowCount ?? 0} holdings`);

    await client.query("COMMIT");
    console.log("\nPromotion committed successfully.");

    // ─── Step 3: Verification ─────────────────────────────────────────────────

    const ac = await client.query<{ count: string }>("SELECT COUNT(*) FROM asset");
    const tc = await client.query<{ count: string }>("SELECT COUNT(*) FROM investment_transaction");
    const hc = await client.query<{ count: string }>("SELECT COUNT(*) FROM holding");

    console.log("\n--- Production row counts ---");
    console.log(`asset:                  ${ac.rows[0].count}`);
    console.log(`investment_transaction: ${tc.rows[0].count}`);
    console.log(`holding:                ${hc.rows[0].count}`);

    const byPlatform = await client.query<{ platform: string; count: string }>(`
      SELECT fi.name AS platform, COUNT(*) AS count
      FROM investment_transaction it
      JOIN financial_institution fi ON fi.id = it.financial_institution_id
      GROUP BY fi.name
      ORDER BY fi.name
    `);
    console.log("\n--- Transactions per platform ---");
    for (const row of byPlatform.rows) {
      console.log(`  ${row.platform.padEnd(20)} ${row.count}`);
    }

    console.log(
      "\nBackup tables retained for review: " +
        "asset_stage_bak, investment_transaction_stage_bak, holding_stage_bak",
    );
    console.log("Drop them (and staging tables) manually after CloudBeaver verification.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Promotion failed — rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  void run();
}
