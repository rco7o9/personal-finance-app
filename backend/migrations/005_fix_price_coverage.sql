-- Up Migration
-- 1. Add amount_inr column to investment_transaction (nullable; seed-amount-inr.ts will backfill and set NOT NULL)
-- 2. Insert missing holding records for any asset with confirmed transactions but no holding row
-- 3. Re-route SGB assets to gold_api / XAU (SGBs are not indexed by Indian Stock Market API)
-- 4. Fix 7 BSE-listed stocks whose ticker_symbol has the wrong .NS suffix

-- 1. amount_inr column
ALTER TABLE investment_transaction
  ADD COLUMN IF NOT EXISTS amount_inr NUMERIC(18,4);

-- 2. Insert missing holding records (idempotent — only inserts where holding row is absent)
INSERT INTO holding (asset_id, quantity, avg_cost, total_invested, current_price, current_value, updated_at)
SELECT
  it.asset_id,
  SUM(CASE WHEN it.type = 'buy' THEN it.quantity ELSE -it.quantity END)              AS quantity,
  SUM(CASE WHEN it.type = 'buy' THEN it.amount   ELSE -it.amount   END)
    / NULLIF(SUM(CASE WHEN it.type = 'buy' THEN it.quantity ELSE -it.quantity END), 0) AS avg_cost,
  SUM(CASE WHEN it.type = 'buy' THEN it.amount   ELSE -it.amount   END)              AS total_invested,
  NULL                                                                                 AS current_price,
  NULL                                                                                 AS current_value,
  NOW()                                                                                AS updated_at
FROM investment_transaction it
LEFT JOIN holding h ON h.asset_id = it.asset_id
WHERE it.status = 'confirmed'
  AND h.asset_id IS NULL
GROUP BY it.asset_id
ON CONFLICT (asset_id) DO NOTHING;

-- 3. SGBs: route to GoldAPI (1 SGB unit = 1g of 24k gold)
UPDATE asset
SET price_source  = 'gold_api',
    ticker_symbol = 'XAU'
WHERE ticker_symbol IN ('SGBMAR28X.NS', 'SGBMAY29I.NS');

-- 4. BSE-listed stocks: correct .NS → .BO
UPDATE asset
SET ticker_symbol = REPLACE(ticker_symbol, '.NS', '.BO')
WHERE ticker_symbol IN (
  'ARCHITORG.NS', 'DHPIND.NS', 'DEEPAKSP.NS',
  'PRIMAPLA.NS',  'TIGLOB.NS', 'TEEAI.NS',   'VIJSOLX.NS'
);

-- Down Migration
-- ALTER TABLE investment_transaction DROP COLUMN IF EXISTS amount_inr;
-- (holding inserts and ticker fixes are not easily reversible; restore from backup if needed)
