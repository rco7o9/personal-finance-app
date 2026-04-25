-- Up Migration
-- Adds five nullable native-currency columns to holding.
-- INR assets will always have NULL here; only USD assets are populated.
-- Populated by: seed-native-columns.ts (avg_cost/invested) and refreshHoldingPrices() (price/value).

ALTER TABLE holding
  ADD COLUMN IF NOT EXISTS native_currency        VARCHAR(3),
  ADD COLUMN IF NOT EXISTS native_avg_cost        NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS native_total_invested  NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS current_price_native   NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS current_value_native   NUMERIC(18,4);

-- Down Migration

-- ALTER TABLE holding
--   DROP COLUMN IF EXISTS native_currency,
--   DROP COLUMN IF EXISTS native_avg_cost,
--   DROP COLUMN IF EXISTS native_total_invested,
--   DROP COLUMN IF EXISTS current_price_native,
--   DROP COLUMN IF EXISTS current_value_native;
