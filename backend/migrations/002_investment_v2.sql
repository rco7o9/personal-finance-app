-- Up Migration
-- Replaces the `investment` table with the immutable ledger pattern:
--   investment_transaction (source of truth) + holding (derived state)
-- Also adds transfer_type to expense for internal transfer detection,
-- and subcategory to asset for finer asset classification.

-- New enums
CREATE TYPE investment_transaction_type   AS ENUM ('buy', 'sell', 'dividend');
CREATE TYPE investment_transaction_source AS ENUM ('manual', 'seeded', 'imported');
CREATE TYPE expense_transfer_type         AS ENUM ('investment_platform', 'household_member', 'own_account');

-- Add subcategory to asset (nullable — not all assets need it)
ALTER TABLE asset ADD COLUMN subcategory TEXT;

-- Add transfer_type to expense (nullable — NULL means regular expense)
ALTER TABLE expense ADD COLUMN transfer_type expense_transfer_type;

-- Drop old investment table
DROP TABLE IF EXISTS investment;

-- investment_transaction — immutable ledger, never UPDATE or DELETE rows
-- Every BUY and SELL is always a new row. Source of truth for XIRR.
CREATE TABLE investment_transaction (
  id                       SERIAL                        PRIMARY KEY,
  asset_id                 INT                           NOT NULL REFERENCES asset(id),
  person_id                INT                           NOT NULL REFERENCES person(id),
  financial_institution_id INT                           NOT NULL REFERENCES financial_institution(id),
  investment_statement_id  INT                           REFERENCES investment_statement(id),
  type                     investment_transaction_type   NOT NULL,
  quantity                 NUMERIC(18,8)                 NOT NULL,
  price                    NUMERIC(18,4)                 NOT NULL,
  amount                   NUMERIC(18,4)                 NOT NULL,
  currency_id              INT                           NOT NULL REFERENCES currency(id),
  transacted_at            DATE                          NOT NULL,
  status                   transaction_status            NOT NULL DEFAULT 'pending',
  is_seed                  BOOLEAN                       NOT NULL DEFAULT FALSE,
  source                   investment_transaction_source NOT NULL DEFAULT 'manual',
  notes                    TEXT,
  created_at               TIMESTAMPTZ                   NOT NULL DEFAULT NOW()
);

-- holding — derived state, recomputed from investment_transaction after every confirm
-- Household-wide: no person_id (aggregate across both persons)
-- current_price and current_value updated separately by price refresh
CREATE TABLE holding (
  id             SERIAL          PRIMARY KEY,
  asset_id       INT             NOT NULL UNIQUE REFERENCES asset(id),
  quantity       NUMERIC(18,8)   NOT NULL DEFAULT 0,
  avg_cost       NUMERIC(18,4)   NOT NULL DEFAULT 0,
  total_invested NUMERIC(18,4)   NOT NULL DEFAULT 0,
  current_price  NUMERIC(18,4),
  current_value  NUMERIC(18,4),
  updated_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Down Migration

DROP TABLE IF EXISTS holding;
DROP TABLE IF EXISTS investment_transaction;

-- Restore original investment table
CREATE TABLE investment (
  id                       SERIAL               PRIMARY KEY,
  person_id                INT                  NOT NULL REFERENCES person(id),
  asset_id                 INT                  NOT NULL REFERENCES asset(id),
  financial_institution_id INT                  NOT NULL REFERENCES financial_institution(id),
  investment_statement_id  INT                  REFERENCES investment_statement(id),
  quantity                 NUMERIC(18,8)        NOT NULL,
  price                    NUMERIC(18,4)        NOT NULL,
  currency_id              INT                  NOT NULL REFERENCES currency(id),
  date                     DATE                 NOT NULL,
  sold_date                DATE,
  sold_quantity            NUMERIC(18,8),
  sold_at_price            NUMERIC(18,4),
  realised_value           NUMERIC(18,4),
  status                   transaction_status   NOT NULL DEFAULT 'pending'
);

ALTER TABLE expense DROP COLUMN IF EXISTS transfer_type;
ALTER TABLE asset   DROP COLUMN IF EXISTS subcategory;

DROP TYPE IF EXISTS expense_transfer_type;
DROP TYPE IF EXISTS investment_transaction_source;
DROP TYPE IF EXISTS investment_transaction_type;
