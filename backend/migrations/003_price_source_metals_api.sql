-- Up Migration
-- Adds 'metals_api' to the price_source enum for physical gold pricing via Metals-API.
-- ALTER TYPE ADD VALUE cannot run inside a transaction block in PostgreSQL.

ALTER TYPE price_source ADD VALUE 'metals_api';

-- Down Migration
-- PostgreSQL does not support removing enum values once added.
-- To roll back: recreate the enum without 'metals_api' and re-cast all columns.
-- Given no rows use 'metals_api' yet at down-migration time this is safe:

-- ALTER TABLE asset ALTER COLUMN price_source TYPE TEXT;
-- DROP TYPE price_source;
-- CREATE TYPE price_source AS ENUM ('yahoo_finance', 'amfi', 'coinmarketcap', 'manual');
-- ALTER TABLE asset ALTER COLUMN price_source TYPE price_source USING price_source::price_source;
