-- Up Migration

-- enums
CREATE TYPE transaction_status AS ENUM ('pending', 'confirmed', 'edited', 'excluded');
CREATE TYPE ledger_statement_type AS ENUM ('savings_account', 'credit_card');
CREATE TYPE income_type AS ENUM ('salary', 'bonus', 'savings_interest');
CREATE TYPE price_source AS ENUM ('yahoo_finance', 'amfi', 'coinmarketcap', 'manual');

-- reference / lookup tables (no FK dependencies)
CREATE TABLE home (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE currency (
  id     SERIAL PRIMARY KEY,
  code   VARCHAR(10) NOT NULL UNIQUE,
  symbol VARCHAR(5)  NOT NULL
);

CREATE TABLE financial_institution (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE expense_category (
  id       SERIAL PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE,
  priority INT  NOT NULL DEFAULT 0
);

CREATE TABLE investment_category (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- person depends on home
CREATE TABLE person (
  id      SERIAL PRIMARY KEY,
  name    TEXT NOT NULL,
  home_id INT  NOT NULL REFERENCES home(id)
);

-- asset depends on investment_category and currency
CREATE TABLE asset (
  id                     SERIAL PRIMARY KEY,
  name                   TEXT         NOT NULL,
  investment_category_id INT          NOT NULL REFERENCES investment_category(id),
  ticker_symbol          TEXT,
  exchange               TEXT,
  price_source           price_source,
  currency_id            INT          NOT NULL REFERENCES currency(id)
);

-- statement tables depend on person and financial_institution
CREATE TABLE ledger_statement (
  id                     SERIAL                   PRIMARY KEY,
  person_id              INT                      NOT NULL REFERENCES person(id),
  financial_institution_id INT                    NOT NULL REFERENCES financial_institution(id),
  type                   ledger_statement_type    NOT NULL,
  start_date             DATE                     NOT NULL,
  end_date               DATE                     NOT NULL,
  file_url               TEXT                     NOT NULL
);

CREATE TABLE investment_statement (
  id                       SERIAL PRIMARY KEY,
  person_id                INT    NOT NULL REFERENCES person(id),
  financial_institution_id INT    NOT NULL REFERENCES financial_institution(id),
  investment_category_id   INT    NOT NULL REFERENCES investment_category(id),
  start_date               DATE   NOT NULL,
  end_date                 DATE   NOT NULL,
  file_url                 TEXT   NOT NULL
);

-- transaction tables
CREATE TABLE expense (
  id                   SERIAL               PRIMARY KEY,
  person_id            INT                  NOT NULL REFERENCES person(id),
  category_id          INT                  NOT NULL REFERENCES expense_category(id),
  ledger_statement_id  INT                  REFERENCES ledger_statement(id),
  amount               NUMERIC(18,4)        NOT NULL,
  currency_id          INT                  NOT NULL REFERENCES currency(id),
  date                 DATE                 NOT NULL,
  description          TEXT,
  status               transaction_status   NOT NULL DEFAULT 'pending'
);

CREATE TABLE income (
  id                   SERIAL               PRIMARY KEY,
  person_id            INT                  NOT NULL REFERENCES person(id),
  ledger_statement_id  INT                  REFERENCES ledger_statement(id),
  date                 DATE                 NOT NULL,
  type                 income_type          NOT NULL,
  amount               NUMERIC(18,4)        NOT NULL,
  currency_id          INT                  NOT NULL REFERENCES currency(id),
  description          TEXT,
  status               transaction_status   NOT NULL DEFAULT 'pending'
);

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

-- baseline / target tables
CREATE TABLE income_baseline (
  id         SERIAL          PRIMARY KEY,
  person_id  INT             NOT NULL REFERENCES person(id),
  month      DATE            NOT NULL,
  type       income_type     NOT NULL,
  amount     NUMERIC(18,4)   NOT NULL
);

CREATE TABLE expense_category_baseline (
  id          SERIAL          PRIMARY KEY,
  category_id INT             NOT NULL REFERENCES expense_category(id),
  person_id   INT             NOT NULL REFERENCES person(id),
  month       DATE            NOT NULL,
  amount      NUMERIC(18,4)   NOT NULL
);

CREATE TABLE portfolio_allocation_target (
  id                     SERIAL          PRIMARY KEY,
  investment_category_id INT             NOT NULL REFERENCES investment_category(id),
  start_date             DATE            NOT NULL,
  end_date               DATE            NOT NULL,
  target_percentage      NUMERIC(5,2)    NOT NULL
);

-- seed data
INSERT INTO home (name) VALUES ('Mehta Family');

INSERT INTO currency (code, symbol) VALUES
  ('INR', '₹'),
  ('USD', '$');

INSERT INTO financial_institution (name) VALUES
  ('HDFC Bank'),
  ('ICICI Bank'),
  ('Zerodha'),
  ('INDMoney'),
  ('PayTM Money'),
  ('CoinSwitch'),
  ('Employer Stock Plan');

INSERT INTO expense_category (name, priority) VALUES
  ('Rent', 1);

INSERT INTO investment_category (name) VALUES
  ('US Equity'),
  ('Indian Equity'),
  ('EPF'),
  ('Indian Mutual Fund'),
  ('Gold ETF'),
  ('Crypto'),
  ('Employer RSU'),
  ('Bank Savings');

INSERT INTO person (name, home_id) VALUES
  ('Arjun', 1),
  ('Priya', 1);

-- Down Migration

DROP TABLE IF EXISTS portfolio_allocation_target;
DROP TABLE IF EXISTS expense_category_baseline;
DROP TABLE IF EXISTS income_baseline;
DROP TABLE IF EXISTS investment;
DROP TABLE IF EXISTS income;
DROP TABLE IF EXISTS expense;
DROP TABLE IF EXISTS investment_statement;
DROP TABLE IF EXISTS ledger_statement;
DROP TABLE IF EXISTS asset;
DROP TABLE IF EXISTS person;
DROP TABLE IF EXISTS investment_category;
DROP TABLE IF EXISTS expense_category;
DROP TABLE IF EXISTS financial_institution;
DROP TABLE IF EXISTS currency;
DROP TABLE IF EXISTS home;

DROP TYPE IF EXISTS price_source;
DROP TYPE IF EXISTS income_type;
DROP TYPE IF EXISTS ledger_statement_type;
DROP TYPE IF EXISTS transaction_status;
