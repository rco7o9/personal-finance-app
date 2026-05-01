-- Up Migration
-- Adds staging tables for the seed-then-promote workflow (Phase 3a).
-- Adds platform_import_config for storing parser metadata (reused in Phase 4+ imports).
-- Staging tables have no FK constraints — safe to inspect and re-run parsers against.
-- asset_stage and investment_transaction_stage are dropped by promote-seed.ts after approval.

CREATE TABLE asset_stage (
  id            SERIAL        PRIMARY KEY,
  name          TEXT          NOT NULL,
  category_name TEXT          NOT NULL,
  ticker_symbol TEXT,
  subcategory   TEXT,
  price_source  TEXT,
  currency_code VARCHAR(3)    NOT NULL,
  platform      TEXT          NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (platform, name)
);

CREATE TABLE investment_transaction_stage (
  id               SERIAL        PRIMARY KEY,
  asset_key        TEXT          NOT NULL,
  person_name      TEXT          NOT NULL,
  institution_name TEXT          NOT NULL,
  type             TEXT          NOT NULL,
  quantity         NUMERIC(18,8) NOT NULL,
  price            NUMERIC(18,4) NOT NULL,
  amount           NUMERIC(18,4) NOT NULL,
  currency_code    VARCHAR(3)    NOT NULL,
  transacted_at    DATE          NOT NULL,
  platform         TEXT          NOT NULL,
  raw_ref          TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Derived staging table: net positions as they would appear after promotion.
-- Computed from investment_transaction_stage by promote-seed.ts (dry-run step)
-- before the actual transaction commits. Allows Arjun to verify quantities/costs
-- are correct before any production rows are touched.
CREATE TABLE holding_stage (
  id             SERIAL        PRIMARY KEY,
  asset_key      TEXT          NOT NULL,
  category_name  TEXT          NOT NULL,
  currency_code  VARCHAR(3)    NOT NULL,
  quantity       NUMERIC(18,8) NOT NULL,
  avg_cost       NUMERIC(18,4) NOT NULL,
  total_invested NUMERIC(18,4) NOT NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (asset_key)
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
