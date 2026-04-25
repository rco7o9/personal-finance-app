-- Up Migration
-- Replaces 'metals_api' with 'gold_api' in the price_source enum.
--
-- ALTER TYPE ADD VALUE has a PostgreSQL limitation: if the same database
-- session that adds a new value then tries to USE it, it raises
-- "unsafe use of new enum value". The node-pg-migrate runner reuses one
-- connection across all pending migrations, so a two-step ADD+UPDATE approach
-- always hits this bug.
--
-- The safe workaround is to drop-and-recreate the enum type in a single
-- transaction: the new type already contains 'gold_api', so there is no
-- newly-added value, and the restriction does not apply.

-- 1. Detach the column from the enum so we can drop the type.
ALTER TABLE asset ALTER COLUMN price_source TYPE TEXT;

-- 2. Drop the old enum (removes metals_api).
DROP TYPE price_source;

-- 3. Recreate the enum with gold_api in place of metals_api.
CREATE TYPE price_source AS ENUM ('yahoo_finance', 'amfi', 'coinmarketcap', 'gold_api', 'manual');

-- 4. Migrate any rows that used the old value.
UPDATE asset SET price_source = 'gold_api' WHERE price_source = 'metals_api';

-- 5. Re-attach the column to the new enum type.
ALTER TABLE asset ALTER COLUMN price_source TYPE price_source USING price_source::price_source;

-- Down Migration
-- ALTER TABLE asset ALTER COLUMN price_source TYPE TEXT;
-- DROP TYPE price_source;
-- CREATE TYPE price_source AS ENUM ('yahoo_finance', 'amfi', 'coinmarketcap', 'metals_api', 'manual');
-- UPDATE asset SET price_source = 'metals_api' WHERE price_source = 'gold_api';
-- ALTER TABLE asset ALTER COLUMN price_source TYPE price_source USING price_source::price_source;
