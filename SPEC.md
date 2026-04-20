# SPEC.md — Database Schema: `001_init.sql`

## 1. Objective

Write `backend/migrations/001_init.sql` — the complete initial PostgreSQL schema for the
personal finance tracker. All Phase 2 (portfolio views) and Phase 3 (statement ingestion)
work depends on this migration existing and being correct.

**Target users:** Arjun & Priya — two-person household, local Docker deployment only.

## 2. Acceptance Criteria

- `npm run migrate:up` applies cleanly against a fresh Postgres instance (no errors)
- `npm run migrate:down` rolls back cleanly (drops all tables and enums in reverse order)
- All 15 tables exist with correct column types, NOT NULL constraints, and FK references
- All 4 enums are created before the tables that reference them
- Seed data is inserted: home, persons, currencies, financial institutions, expense
  categories, investment categories

## 3. Enums

| Enum name               | Values                                          | Used by                                    |
|-------------------------|-------------------------------------------------|--------------------------------------------|
| `transaction_status`    | `pending`, `confirmed`, `edited`, `excluded`    | `expense`, `income`, `investment`          |
| `ledger_statement_type` | `savings_account`, `credit_card`                | `ledger_statement`                         |
| `income_type`           | `salary`, `bonus`, `savings_interest`           | `income`, `income_baseline`                |
| `price_source`          | `yahoo_finance`, `amfi`, `coinmarketcap`, `manual` | `asset`                                 |

`income_type` is designed to grow — new values added via `ALTER TYPE ... ADD VALUE`.

## 4. Tables

### `home`
| Column | Type              | Constraints  |
|--------|-------------------|--------------|
| `id`   | `SERIAL`          | PK           |
| `name` | `TEXT`            | NOT NULL     |

### `person`
| Column    | Type     | Constraints          |
|-----------|----------|----------------------|
| `id`      | `SERIAL` | PK                   |
| `name`    | `TEXT`   | NOT NULL             |
| `home_id` | `INT`    | NOT NULL, FK → home  |

### `currency`
| Column   | Type          | Constraints       |
|----------|---------------|-------------------|
| `id`     | `SERIAL`      | PK                |
| `code`   | `VARCHAR(10)` | NOT NULL, UNIQUE  |
| `symbol` | `VARCHAR(5)`  | NOT NULL          |

### `financial_institution`
Covers banks (HDFC, Axis) and investment platforms (Zerodha, INDMoney, CoinSwitch).

| Column | Type     | Constraints       |
|--------|----------|-------------------|
| `id`   | `SERIAL` | PK                |
| `name` | `TEXT`   | NOT NULL, UNIQUE  |

### `expense_category`
| Column     | Type     | Constraints       |
|------------|----------|-------------------|
| `id`       | `SERIAL` | PK                |
| `name`     | `TEXT`   | NOT NULL, UNIQUE  |
| `priority` | `INT`    | NOT NULL DEFAULT 0 |

### `investment_category`
| Column | Type     | Constraints       |
|--------|----------|-------------------|
| `id`   | `SERIAL` | PK                |
| `name` | `TEXT`   | NOT NULL, UNIQUE  |

### `asset`
One row per investable instrument. `ticker_symbol`, `exchange`, and `price_source` are
populated when known; left NULL for manually-valued assets.

| Column                 | Type           | Constraints                          |
|------------------------|----------------|--------------------------------------|
| `id`                   | `SERIAL`       | PK                                   |
| `name`                 | `TEXT`         | NOT NULL                             |
| `investment_category_id` | `INT`        | NOT NULL, FK → investment_category   |
| `ticker_symbol`        | `TEXT`         | nullable                             |
| `exchange`             | `TEXT`         | nullable (e.g. NASDAQ, NSE, CRYPTO)  |
| `price_source`         | `price_source` | nullable                             |
| `currency_id`          | `INT`          | NOT NULL, FK → currency (native price currency) |

### `ledger_statement`
One row per uploaded bank or credit card PDF/CSV.

| Column                    | Type                     | Constraints                             |
|---------------------------|--------------------------|-----------------------------------------|
| `id`                      | `SERIAL`                 | PK                                      |
| `person_id`               | `INT`                    | NOT NULL, FK → person                   |
| `financial_institution_id`| `INT`                    | NOT NULL, FK → financial_institution    |
| `type`                    | `ledger_statement_type`  | NOT NULL                                |
| `start_date`              | `DATE`                   | NOT NULL                                |
| `end_date`                | `DATE`                   | NOT NULL                                |
| `file_url`                | `TEXT`                   | NOT NULL                                |

### `investment_statement`
One row per uploaded investment statement. One statement covers one investment category
(e.g. one INDMoney US Equity statement, one Zerodha ETF statement).

| Column                    | Type     | Constraints                              |
|---------------------------|----------|------------------------------------------|
| `id`                      | `SERIAL` | PK                                       |
| `person_id`               | `INT`    | NOT NULL, FK → person                    |
| `financial_institution_id`| `INT`    | NOT NULL, FK → financial_institution     |
| `investment_category_id`  | `INT`    | NOT NULL, FK → investment_category       |
| `start_date`              | `DATE`   | NOT NULL                                 |
| `end_date`                | `DATE`   | NOT NULL                                 |
| `file_url`                | `TEXT`   | NOT NULL                                 |

### `expense`
| Column                | Type                  | Constraints                                       |
|-----------------------|-----------------------|---------------------------------------------------|
| `id`                  | `SERIAL`              | PK                                                |
| `person_id`           | `INT`                 | NOT NULL, FK → person                             |
| `category_id`         | `INT`                 | NOT NULL, FK → expense_category                   |
| `ledger_statement_id` | `INT`                 | nullable, FK → ledger_statement (NULL = manual)   |
| `amount`              | `NUMERIC(18,4)`       | NOT NULL                                          |
| `currency_id`         | `INT`                 | NOT NULL, FK → currency                           |
| `date`                | `DATE`                | NOT NULL                                          |
| `description`         | `TEXT`                | nullable                                          |
| `status`              | `transaction_status`  | NOT NULL DEFAULT 'pending'                        |

### `income`
| Column                | Type                  | Constraints                                       |
|-----------------------|-----------------------|---------------------------------------------------|
| `id`                  | `SERIAL`              | PK                                                |
| `person_id`           | `INT`                 | NOT NULL, FK → person                             |
| `ledger_statement_id` | `INT`                 | nullable, FK → ledger_statement (NULL = manual)   |
| `date`                | `DATE`                | NOT NULL (exact transaction date)                 |
| `type`                | `income_type`         | NOT NULL                                          |
| `amount`              | `NUMERIC(18,4)`       | NOT NULL                                          |
| `currency_id`         | `INT`                 | NOT NULL, FK → currency                           |
| `description`         | `TEXT`                | nullable                                          |
| `status`              | `transaction_status`  | NOT NULL DEFAULT 'pending'                        |

### `investment`
Each row is a buy lot. Partial sales recorded directly on the lot via `sold_*` columns.
`financial_institution_id` is denormalized from `investment_statement` for query
convenience (portfolio-by-platform queries).

| Column                      | Type                  | Constraints                                           |
|-----------------------------|-----------------------|-------------------------------------------------------|
| `id`                        | `SERIAL`              | PK                                                    |
| `person_id`                 | `INT`                 | NOT NULL, FK → person                                 |
| `asset_id`                  | `INT`                 | NOT NULL, FK → asset                                  |
| `financial_institution_id`  | `INT`                 | NOT NULL, FK → financial_institution                  |
| `investment_statement_id`   | `INT`                 | nullable, FK → investment_statement (NULL = manual)   |
| `quantity`                  | `NUMERIC(18,8)`       | NOT NULL                                              |
| `price`                     | `NUMERIC(18,4)`       | NOT NULL (price per unit at buy time)                 |
| `currency_id`               | `INT`                 | NOT NULL, FK → currency (currency of price)           |
| `date`                      | `DATE`                | NOT NULL (purchase date)                              |
| `sold_date`                 | `DATE`                | nullable                                              |
| `sold_quantity`             | `NUMERIC(18,8)`       | nullable (supports partial sales)                     |
| `sold_at_price`             | `NUMERIC(18,4)`       | nullable                                              |
| `realised_value`            | `NUMERIC(18,4)`       | nullable (positive = gain, negative = loss)           |
| `status`                    | `transaction_status`  | NOT NULL DEFAULT 'pending'                            |

### `income_baseline`
Expected monthly income per person. Used for deficit/surplus calculation.

| Column      | Type           | Constraints                    |
|-------------|----------------|--------------------------------|
| `id`        | `SERIAL`       | PK                             |
| `person_id` | `INT`          | NOT NULL, FK → person          |
| `month`     | `DATE`         | NOT NULL (first of month)      |
| `type`      | `income_type`  | NOT NULL                       |
| `amount`    | `NUMERIC(18,4)`| NOT NULL                       |

### `expense_category_baseline`
Monthly budget per category per person.

| Column        | Type            | Constraints                        |
|---------------|-----------------|------------------------------------|
| `id`          | `SERIAL`        | PK                                 |
| `category_id` | `INT`           | NOT NULL, FK → expense_category    |
| `person_id`   | `INT`           | NOT NULL, FK → person              |
| `month`       | `DATE`          | NOT NULL (first of month)          |
| `amount`      | `NUMERIC(18,4)` | NOT NULL                           |

### `portfolio_allocation_target`
Yearly target allocation percentage per investment category. One row per category per FY.
`start_date` / `end_date` represent the financial year (e.g. 2026-04-01 → 2027-03-31).

| Column                   | Type            | Constraints                          |
|--------------------------|-----------------|--------------------------------------|
| `id`                     | `SERIAL`        | PK                                   |
| `investment_category_id` | `INT`           | NOT NULL, FK → investment_category   |
| `start_date`             | `DATE`          | NOT NULL                             |
| `end_date`               | `DATE`          | NOT NULL                             |
| `target_percentage`      | `NUMERIC(5,2)`  | NOT NULL                             |

## 5. Seed Data

### `home`
| name             |
|------------------|
| Mehta Family   |

### `person`
| name     | home_id |
|----------|---------|
| Arjun    | 1       |
| Priya | 1       |

### `currency`
| code | symbol |
|------|--------|
| INR  | ₹      |
| USD  | $      |

### `financial_institution`
HDFC Bank, Axis Bank, ICICI Bank, Zerodha, INDMoney, PayTM Money, CoinSwitch, Kuvera,
Groww, Employer stock (for RSU vesting)

### `expense_category`
| name             | priority |
|------------------|----------|
| Rent / EMI       | 1        |
| Groceries        | 2        |
| Insurance        | 3        |
| Utilities        | 4        |
| Food & Dining    | 5        |
| Transport        | 6        |
| Shopping         | 7        |
| Healthcare       | 8        |
| Subscriptions    | 9        |
| Education        | 10       |
| Miscellaneous    | 99       |

### `investment_category`
US Equity, Indian Equity, Mutual Fund, ETF, Crypto, RSU, Liquid Fund, Gold,
Fixed Deposit, PPF / NPS

## 6. Migration Structure

- File: `backend/migrations/001_init.sql`
- Wrapped in a single `BEGIN` / `COMMIT` block
- Order: enums → reference tables (home, currency, financial_institution,
  expense_category, investment_category) → asset → persons → statement tables →
  transaction tables (expense, income, investment) → baseline / target tables → seed data
- `migrate:down` drops tables in reverse FK dependency order, then drops enums

## 7. What This Spec Does NOT Cover

- NestJS modules, controllers, services (Phase 2+)
- pgtyped codegen — runs after schema exists (Phase 2)
- Frontend components
- Runtime price fetching logic (Phase 2)
- Statement PDF/CSV parsing and Claude AI integration (Phase 3)
- Manual entry UI flows (Phase 2+)
