-- Up Migration
-- Adds staging tables for the seed-then-promote workflow (Phase 3a).
-- Staging tables mirror the production schema exactly (same column names/types),
-- with two differences: no FK constraints, and enums stored as TEXT.
--
-- asset_stage.id values are staging-only PKs; promote-seed.ts uses them to
-- join investment_transaction_stage → asset_stage, then remaps to real asset.id
-- after upserting into production.
--
-- Idempotency: TRUNCATE all three staging tables before re-running parsers.
-- Use ON CONFLICT (name) DO UPDATE on asset_stage within a single parser run
-- to handle the same asset appearing across multiple files.
--
-- Adds platform_import_config (permanent) for per-platform parser metadata.
-- All three staging tables are dropped by promote-seed.ts after approval.

-- asset_stage mirrors asset exactly (no FK constraints, price_source as TEXT):
CREATE TABLE asset_stage (
  id                     SERIAL PRIMARY KEY,
  name                   TEXT   NOT NULL,
  investment_category_id INT    NOT NULL,
  ticker_symbol          TEXT,
  exchange               TEXT,
  price_source           TEXT,
  currency_id            INT    NOT NULL,
  subcategory            TEXT,
  UNIQUE (name)
);

-- investment_transaction_stage mirrors investment_transaction exactly
-- (no FK constraints, enums as TEXT, amount_inr defaults to 0 for USD rows —
-- backfilled by seed-amount-inr.ts after promotion):
CREATE TABLE investment_transaction_stage (
  id                       SERIAL        PRIMARY KEY,
  asset_id                 INT           NOT NULL,
  person_id                INT           NOT NULL,
  financial_institution_id INT           NOT NULL,
  investment_statement_id  INT,
  type                     TEXT          NOT NULL,
  quantity                 NUMERIC(18,8) NOT NULL,
  price                    NUMERIC(18,4) NOT NULL,
  amount                   NUMERIC(18,4) NOT NULL,
  currency_id              INT           NOT NULL,
  transacted_at            DATE          NOT NULL,
  status                   TEXT          NOT NULL DEFAULT 'confirmed',
  is_seed                  BOOLEAN       NOT NULL DEFAULT TRUE,
  source                   TEXT          NOT NULL DEFAULT 'seeded',
  notes                    TEXT,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  amount_inr               NUMERIC(18,4) NOT NULL DEFAULT 0
);

-- holding_stage mirrors holding exactly (including native columns from migration 006):
-- Populated by promote-seed.ts dry-run before the real promotion commits,
-- so Arjun can verify net positions in CloudBeaver first.
CREATE TABLE holding_stage (
  id                    SERIAL        PRIMARY KEY,
  asset_id              INT           NOT NULL,
  quantity              NUMERIC(18,8) NOT NULL DEFAULT 0,
  avg_cost              NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_invested        NUMERIC(18,4) NOT NULL DEFAULT 0,
  current_price         NUMERIC(18,4),
  current_value         NUMERIC(18,4),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  native_currency       VARCHAR(3),
  native_avg_cost       NUMERIC(18,4),
  native_total_invested NUMERIC(18,4),
  current_price_native  NUMERIC(18,4),
  current_value_native  NUMERIC(18,4),
  UNIQUE (asset_id)
);

CREATE TABLE platform_import_config (
  id                       SERIAL      PRIMARY KEY,
  financial_institution_id INT         NOT NULL REFERENCES financial_institution(id),
  file_format              TEXT        NOT NULL,
  parser_key               TEXT        NOT NULL,
  config                   JSONB       NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (financial_institution_id, parser_key)
);

INSERT INTO platform_import_config (financial_institution_id, file_format, parser_key, config) VALUES
  (
    (SELECT id FROM financial_institution WHERE name = 'Zerodha'),
    'csv',
    'zerodha',
    '{"header_row": 0, "date_col": "trade_date", "type_col": "trade_type", "qty_col": "quantity", "price_col": "price", "id_col": "order_id", "aggregate_by_order_id": true}'
  ),
  (
    (SELECT id FROM financial_institution WHERE name = 'INDMoney'),
    'xls',
    'indmoney',
    '{"header_row": 10, "date_col": "Order Execution Time", "type_col": "Transaction Type", "qty_col": "Quantity", "price_col": "Price ($)", "currency": "USD"}'
  ),
  (
    (SELECT id FROM financial_institution WHERE name = 'CoinSwitch'),
    'xlsx',
    'coinswitch',
    '{"sheet": "Spot Trades", "header_row": 17, "date_col": "Date", "market_col": "Market", "qty_col": "Volume", "total_col": "Total", "type_col": "Trade Type"}'
  ),
  (
    (SELECT id FROM financial_institution WHERE name = 'PayTM Money'),
    'pdf',
    'paytm_money',
    '{"table_cols": ["Date","Mutual Fund Scheme Name","Folio No","Type","Units","NAV","Amount","Status"], "buy_types": ["Purchase - SIP","Purchase - Lumpsum"], "sell_types": ["Withdraw"]}'
  ),
  (
    (SELECT id FROM financial_institution WHERE name = 'Employer stock'),
    'pdf',
    'employer-stock',
    '{"purchase_table": "Summary of Stock/Shares Holdings", "withdrawal_header_prefix": "Withdrawal on"}'
  );

-- Down Migration

DROP TABLE IF EXISTS platform_import_config;
DROP TABLE IF EXISTS holding_stage;
DROP TABLE IF EXISTS investment_transaction_stage;
DROP TABLE IF EXISTS asset_stage;
