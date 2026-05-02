# Spec: Phase 3 Seed — Investment Transactions Ingestion

## Objective

Seed the `investment_transaction`, `holding`, and `asset` tables with real historical
transaction data from five investment platforms. This replaces the placeholder seed data
(fake 2026-04-01 dates, approximate quantities) with accurate lot-level records covering
2019–2026.

**Two-phase workflow (staging → promotion):**
1. All parser scripts write into staging tables (`asset_stage`, `investment_transaction_stage`) — no FK constraints, easy to inspect in CloudBeaver.
2. After Arjun reviews and approves the staging tables, a single promote script copies approved data into the real `asset` and `investment_transaction` tables, rebuilds `holding`, and drops the staging tables.

All promoted transactions are tagged `source = 'seeded'`, `is_seed = TRUE`,
`status = 'confirmed'` so they appear immediately in portfolio reports without HITL review.

A new `platform_import_config` table is introduced in this phase so each platform's
parsing metadata is stored in the DB — enabling the same parser code to be reused for
monthly statement imports in Phase 4+.

---

## Assumptions — Confirm Before Implementing

```
ASSUMPTIONS I'M MAKING:
1. Zerodha partial fills (multiple rows with the same order_id) are AGGREGATED
   into one investment_transaction row: sum(quantity), weighted-avg price,
   earliest order_execution_time as transacted_at.
2. CoinSwitch: only the "Spot Trades" sheet is processed. Futures, INR Futures,
   and Boost Trades sheets are skipped.
3. Employer stock purchase PDFs: each Holdings table row = one BUY transaction.
   acquisition_date = transacted_at, cost_basis_per_share = price,
   total_shares_you_hold = quantity.
4. All seed transactions land as status = 'confirmed' (pre-verified, no HITL needed).
5. One investment_statement row is created per platform per person (all-time seed),
   and all transactions for that platform+person link to it.
6. platform_import_config table is introduced in this phase (new migration 007).
7. Paytm Money: Franklin India Liquid Fund is INCLUDED (purchase + same-day withdraw
   are both seeded; they wash out to zero net quantity in the holding).
8. Employer stock: ticker_symbol = 'ACME' (NYSE-listed), price_source = 'yahoo_finance'.
9. Crypto assets (BTC, ETH): price_source = 'coinmarketcap'.
   currency_id = INR (CoinSwitch trades are INR-denominated).
10. Mutual funds: price_source = 'amfi', currency_id = INR.
→ Correct me before implementing any platform.
```

---

## Tech Stack

- **Runtime:** Node.js TypeScript scripts in `backend/scripts/`
- **Libraries:** `csv-parse`, `xlsx` (already used), `pdf-parse` (new dep for PDF),
  `decimal.js` for all arithmetic — never `parseFloat()`
- **DB:** node-postgres pool — same `DatabaseModule` pattern as existing seeds
- **Migration:** node-pg-migrate (migration 007 adds `platform_import_config`)

---

## Commands

```bash
# From backend/
npm run migrate:up                           # migration 007: staging tables + platform_import_config

# Phase 1 — parse into staging tables (run in order, safe to re-run)
npx ts-node scripts/seed-zerodha.ts         # Indian equities → *_stage tables
npx ts-node scripts/seed-indmoney.ts        # US equities → *_stage tables
npx ts-node scripts/seed-coinswitch.ts      # Crypto → *_stage tables
npx ts-node scripts/seed-paytm-money.ts    # Mutual funds → *_stage tables (AMFI codes required first)
npx ts-node scripts/seed-employer-stock.ts       # Employee stock → *_stage tables

# Review staging tables in CloudBeaver before proceeding:
#   SELECT platform, COUNT(*) FROM investment_transaction_stage GROUP BY platform;
#   SELECT * FROM asset_stage ORDER BY category_name, name;

# Phase 2 — promote after approval
npx ts-node scripts/promote-seed.ts         # clear old data → insert from stage → rebuild holding → drop stage
npm run seed:native-columns                 # backfill native USD columns (IndMoney + Employer stock)
# Then trigger price refresh via API to rebuild current_price / current_value
```

All parse scripts are **idempotent**: re-running clears and rewrites that platform's rows
in the staging tables. Staging tables never touch production data until `promote-seed.ts`
is run.

---

## Project Structure

```
backend/
  migrations/
    007_platform_import_config.sql      ← new (staging tables + platform_import_config)
  scripts/
    seed-zerodha.ts                     ← new (Phase 1 parser)
    seed-indmoney.ts                    ← new (Phase 1 parser)
    seed-coinswitch.ts                  ← new (Phase 1 parser)
    seed-paytm-money.ts                 ← new (Phase 1 parser — needs AMFI codes first)
    seed-employer-stock.ts                    ← new (Phase 1 parser — 3 purchase formats + 6 withdrawals)
    promote-seed.ts                     ← new (Phase 2 promotion + holding rebuild)
    seed-native-columns.ts              ← existing (re-run after promotion)
  src/
    investments/                        ← existing module, no changes this phase
investments_seed_data/                  ← gitignored, local only
  zerodha_trades_seed/
    zerodha_trades_seed_FY*.csv         ← 8 files
  ind_money_trades_seed/
    ind_money_trades_seed_all_time_arjun.xls
    ind_money_trades_seed_all_time_priya.xls
  coinswitch_trades_seed_all_time_arjun.xlsx
  paytm_money_trades_seed/
    paytm_money_trades_seed_all_time_arjun.pdf
    paytm_money_trades_seed_all_time_priya.pdf
  employer_stock_trades_seed/
    employer_stock_seed_purchase_1_arjun.pdf  ← RSU vests (Holdings table format)
    employer_stock_seed_purchase_2_arjun.pdf  ← Stock option exercise (Exercise ERH-* format)
    employer_stock_seed_purchase_3_arjun.pdf  ← ESPP purchases (Purchase History format)
    employer_stock_seed_withdrawal_{1-6}_arjun.pdf
```

---

## Migration 007 — Staging Tables + `platform_import_config`

### Staging tables (dropped after promotion)

```sql
CREATE TABLE asset_stage (
  id            SERIAL        PRIMARY KEY,
  name          TEXT          NOT NULL,
  category_name TEXT          NOT NULL,  -- 'Indian Equity', 'US Equity', 'Crypto', etc.
  ticker_symbol TEXT,                    -- NULL for MFs until AMFI codes confirmed
  subcategory   TEXT,                    -- 'Tax Saver - ELSS', 'Equity - Large Cap', etc.
  price_source  TEXT,                    -- 'yahoo_finance' | 'amfi' | 'coinmarketcap' | 'manual'
  currency_code VARCHAR(3)    NOT NULL,
  platform      TEXT          NOT NULL,  -- which parser wrote this row
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (platform, name)               -- dedup within platform
);

CREATE TABLE investment_transaction_stage (
  id                   SERIAL        PRIMARY KEY,
  asset_key            TEXT          NOT NULL,  -- matches asset_stage.name for resolution
  person_name          TEXT          NOT NULL,  -- 'Arjun' | 'Priya'
  institution_name     TEXT          NOT NULL,  -- 'Zerodha' | 'INDMoney' | etc.
  type                 TEXT          NOT NULL,  -- 'buy' | 'sell'
  quantity             NUMERIC(18,8) NOT NULL,
  price                NUMERIC(18,4) NOT NULL,
  amount               NUMERIC(18,4) NOT NULL,
  currency_code        VARCHAR(3)    NOT NULL,
  transacted_at        DATE          NOT NULL,
  platform             TEXT          NOT NULL,
  raw_ref              TEXT,                    -- original order_id / transaction_id / reference
  notes                TEXT,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
```

### `platform_import_config` (permanent)

```sql
CREATE TABLE platform_import_config (
  id                       SERIAL       PRIMARY KEY,
  financial_institution_id INT          NOT NULL REFERENCES financial_institution(id),
  file_format              TEXT         NOT NULL,  -- 'csv' | 'xlsx' | 'xls' | 'pdf'
  parser_key               TEXT         NOT NULL,  -- matches script name: 'zerodha' | 'indmoney' | etc.
  config                   JSONB        NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (financial_institution_id, parser_key)
);
```

Seed rows inserted by the migration (one per platform):

| financial_institution | file_format | parser_key    | config (key fields)                                      |
|-----------------------|-------------|---------------|----------------------------------------------------------|
| Zerodha               | csv         | zerodha       | `{ "header_row": 0, "date_col": "trade_date", "type_col": "trade_type", "qty_col": "quantity", "price_col": "price", "id_col": "order_id", "aggregate_by_order_id": true }` |
| INDMoney              | xls         | indmoney      | `{ "header_row": 10, "date_col": "Order Execution Time", "type_col": "Transaction Type", "qty_col": "Quantity", "price_col": "Price ($)", "currency": "USD" }` |
| CoinSwitch            | xlsx        | coinswitch    | `{ "sheet": "Spot Trades", "header_row": 17, "date_col": "Date", "market_col": "Market", "qty_col": "Volume", "total_col": "Total", "type_col": "Trade Type" }` |
| PayTM Money           | pdf         | paytm_money   | `{ "table_cols": ["Date","Mutual Fund Scheme Name","Folio No","Type","Units","NAV","Amount","Status"], "buy_types": ["Purchase - SIP","Purchase - Lumpsum"], "sell_types": ["Withdraw"] }` |
| Employer stock              | pdf         | employer-stock      | `{ "purchase_table": "Summary of Stock/Shares Holdings", "withdrawal_header_prefix": "Withdrawal on" }` |

---

## Platform Parsing Rules

### 1. Zerodha — Indian Equities (Arjun only)

**Files:** `zerodha_trades_seed/zerodha_trades_seed_FY*.csv` (8 files)
**Volume:** ~1,656 raw rows → fewer aggregated transactions

**CSV columns:**
```
symbol, isin, trade_date, exchange, segment, series,
trade_type, auction, quantity, price, trade_id, order_id, order_execution_time
```

**Parsing rules:**
- Group rows by `order_id` → one `investment_transaction` per order
- Aggregated row: `quantity = SUM(quantity)`, `price = weighted_avg(price, quantity)`,
  `amount = SUM(quantity * price)`, `transacted_at = MIN(order_execution_time).date()`
- `type`: `trade_type = 'buy'` → `'buy'`, `'sell'` → `'sell'`
- Asset lookup/creation: match on `isin`. If missing, insert with:
  - `name = symbol` (display; may update later)
  - `ticker_symbol = symbol + '.' + exchange` (e.g. `TIGLOB.BSE`, `AXISGOLD.NSE`)
  - `investment_category_id` = Gold ETF if `segment = 'EQ'` AND ticker matches gold ETF
    pattern (`*GOLD*` in symbol or ISIN known), else Indian Equity
  - `price_source = 'yahoo_finance'`
  - `currency_id = INR`
- `financial_institution_id` = Zerodha
- `person_id` = Arjun

**Gold ETF detection:** AXISGOLD (INF846K01W80) → Gold ETF category. All others → Indian Equity.

---

### 2. IndMoney — US Equities (Arjun + Priya)

**Files:** `ind_money_trades_seed/ind_money_trades_seed_all_time_{person}.xls` (2 files)
**Volume:** Arjun ~129 rows, Priya ~17 rows

**XLS structure:**
- Rows 0–9: account metadata (skip)
- Row 10 (0-indexed): header
- Row 11+: data

**Columns:**
```
Stock Name, Stock Symbol, Order Placed Time, Order Execution Time,
Broker Reference Id, Transaction Type, Order Type,
Quantity, Price ($), Order Amount ($), Brokerage ($)
```

**Parsing rules:**
- Date: `"20 May 2022, 12:00 AM"` → parse with `new Date()` or date-fns
- `type`: `Transaction Type = 'BUY'` → `'buy'`, `'SELL'` → `'sell'`
- `quantity` = `Quantity` (fractional shares, e.g. 1.661284796)
- `price` = `Price ($)` (USD)
- `amount` = `Order Amount ($)` (USD)
- Asset lookup/creation: match on `Stock Symbol`. If missing, insert with:
  - `name = Stock Name`
  - `ticker_symbol = Stock Symbol` (bare, no suffix — US stocks on Yahoo Finance)
  - `investment_category_id` = US Equity
  - `price_source = 'yahoo_finance'`
  - `currency_id = USD`
- `financial_institution_id` = INDMoney
- Person: `arjun.xls` → Arjun, `priya.xls` → Priya

**amount_inr:** Not stored directly — `seed-native-columns.ts` handles this after all platforms.

---

### 3. CoinSwitch — Crypto (Arjun only)

**File:** `coinswitch_trades_seed_all_time_arjun.xlsx`
**Sheet:** `Spot Trades` only
**Volume:** ~45 rows (rows 18–64 in sheet)

**Sheet structure:**
- Rows 0–16: metadata / header (skip)
- Row 17 (0-indexed): column headers
- Row 18+: data

**Columns:**
```
Transaction Id, Date, Market, Price, Volume, Total, Trade Type,
TDS Amount, TDS Paid In, TDS In INR, Fee Paid In, Fee Amount
```

**Parsing rules:**
- `Market`: `"BTCINR"` → base = `"BTC"`, quote = `"INR"`. `"ETHINR"` → base = `"ETH"`.
- `Price`: string like `"6,220,380.553889004597 INR"` → strip commas + ` INR` → `Decimal`
- `Volume` (quantity): already numeric (e.g. `0.00321689`)
- `Total` (amount): string like `"20,010.28 INR"` → strip commas + ` INR` → `Decimal`
- Date: `"2026-02-28 15:59:13"` → parse as UTC
- `type`: `"BUY"` → `'buy'`, `"SELL"` → `'sell'`
- Asset lookup/creation: match on symbol (`"BTC"`, `"ETH"`). If missing, insert with:
  - `name = "Bitcoin"` / `"Ethereum"` (hardcoded map)
  - `ticker_symbol = "BTC-INR"` / `"ETH-INR"` (Yahoo Finance format for INR-denominated)
  - `investment_category_id` = Crypto
  - `price_source = 'coinmarketcap'`
  - `currency_id = INR`
- `financial_institution_id` = CoinSwitch
- `person_id` = Arjun

---

### 4. Paytm Money — Indian Mutual Funds (Arjun + Priya)

**Files:** `paytm_money_trades_seed_all_time_{person}.pdf` (2 files, Arjun = 19 pages)
**Volume:** Arjun ~250+ transactions across multiple schemes (2019–2026)

**PDF parsing strategy:** Use `pdf-parse` to extract full text, then regex the table rows.

**Table row pattern (from extracted text):**
```
DD Mon YYYY  <Scheme Name>\n(<Category>)  <Folio>  <Type>  <Units>  <NAV>  <Amount>  Confirmed
```

**Parsing rules:**
- `Type` mapping:
  - `"Purchase - SIP"` → `'buy'`
  - `"Purchase - Lumpsum"` → `'buy'`
  - `"Withdraw"` → `'sell'`
- `quantity` = Units (e.g. `339.884`)
- `price` = NAV (e.g. `32.3624` — strip ₹ symbol)
- `amount` = Amount (e.g. `11000.00` — strip ₹ and commas)
- `transacted_at` = Date (e.g. `"15 Apr 2026"` → parse)
- Asset lookup/creation: match on scheme name (exact string). Write to `asset_stage` with:
  - `name = scheme_name` (full name from PDF)
  - `ticker_symbol = NULL` ← **AMFI code needed from Arjun before promotion** (see below)
  - `subcategory` = category in parens, e.g. `"Tax Saver - ELSS"`, `"Equity - Large Cap"`
  - `investment_category_id` = Indian Mutual Fund (Gold funds → Gold ETF)
  - `price_source = 'amfi'`
  - `currency_id = INR`
- `financial_institution_id` = PayTM Money
- Person: `arjun.pdf` → Arjun, `priya.pdf` → Priya

**⚠️ AMFI codes required before promotion:**
The `ticker_symbol` column on `asset` is used for price lookup. For mutual funds,
this must be the AMFI scheme code. Before running `promote-seed.ts`, Arjun must provide
the AMFI code for each of the following unique schemes found in the PDFs:

| Scheme Name (from PDF) | Subcategory | AMFI Code |
|---|---|---|
| Parag Parikh ELSS Tax Saver Fund Direct - Growth | Tax Saver - ELSS | _ask_ |
| Parag Parikh Flexi Cap Fund Direct Growth | Equity - Flexi Cap | _ask_ |
| Axis ELSS Tax Saver Direct Plan Growth | Tax Saver - ELSS | _ask_ |
| Axis Bluechip Fund Direct Plan Growth | Equity - Large Cap | _ask_ |
| Axis Midcap Direct Plan Growth | Equity - Mid Cap | _ask_ |
| DSP ELSS Tax Saver Direct Plan Growth | Tax Saver - ELSS | _ask_ |
| Mirae Asset Large & Midcap Fund Direct-Growth | Equity - Large & MidCap | _ask_ |
| SBI Gold Direct Plan Growth | Gold & Silver - Gold | _ask_ |
| Kotak Gold Fund Direct Growth | Gold & Silver - Gold | _ask_ |
| Tata ELSS Tax Saver Fund Direct Growth | Tax Saver - ELSS | _ask_ |
| Franklin India Liquid Fund Super Institutional Plan Direct Growth | Debt - Liquid | _ask_ |

Priya's unique schemes (if any different from Arjun's) will be listed after her PDF is parsed.

**Gold funds** (SBI Gold, Kotak Gold) → `investment_category_id` = Gold ETF

---

### 5. Employer stock — Employee Stock (Arjun only)

**Files:**
- `employer_stock_seed_purchase_1_arjun.pdf` — RSU vests (Holdings table)
- `employer_stock_seed_purchase_2_arjun.pdf` — Stock option exercise (Exercise ERH-* format)
- `employer_stock_seed_purchase_3_arjun.pdf` — ESPP purchases (Purchase History format)
- `employer_stock_seed_withdrawal_{1-6}_arjun.pdf` — 6 sale PDFs (identical format)

Each of the 3 purchase PDFs has a completely different structure:

---

**Purchase PDF 1 — RSU Vests:** `employer_stock_seed_purchase_1_arjun.pdf`

Table title: "Summary of Stock/Shares Holdings" | Section: "Type of Money: Employee"

| Fund | Acquisition Date | Lot | Capital Gain Impact | Cost Basis | Cost Basis Per Share | Total Shares You Hold | Current Price per Share | Current Value |

Each row = one RSU vest BUY:
- `transacted_at` = Acquisition Date (e.g. `"15-Mar-2024"` → parse `DD-Mon-YYYY`)
- `quantity` = Total Shares You Hold (integer, e.g. `971`)
- `price` = Cost Basis Per Share (strip `$` and ` USD`, e.g. `13.05`)
- `amount` = Cost Basis (strip `$`, commas, and ` USD`, e.g. `12671.55`)
- `type` = `'buy'`

---

**Purchase PDF 2 — Stock Option Exercise:** `employer_stock_seed_purchase_2_arjun.pdf`

Format: Key-value pairs in an "Exercise (ERH-...)" block, followed by "Grants" and "Cost" tables.

Fields to extract:
- `Transaction Date` → `transacted_at` (e.g. `"02-Jun-2021"`)
- `Held Quantity` → `quantity` (e.g. `155`)
- Grant Price from Grants table → `price` (e.g. `$4.25 USD`)
- `Cost of Options` from Cost table → `amount` (e.g. `$658.75 USD`)
- `type` = `'buy'`

Note: Fair Market Value ($12.88) is NOT the price paid — Grant Price is. Cost of Options = Grant Price × Held Quantity.

---

**Purchase PDF 3 — ESPP Purchases:** `employer_stock_seed_purchase_3_arjun.pdf`

Table title: "Purchase History for Stock/Shares" | Section: "Fund: Acme Corp, Inc."

| Grant Date | Subscription Date | Subscription Date FMV | Purchase Date | Purchase Date FMV | Purchase Price | Shares Purchased | Total Shares You Hold | Current Share Price | Current Value |

Each row = one ESPP purchase BUY:
- `transacted_at` = Purchase Date (e.g. `"15-Dec-2021"`)
- `quantity` = **Shares Purchased** (NOT Total Shares You Hold — use `317`, not `200`)
- `price` = Purchase Price (e.g. `$12.84 USD`)
- `amount` = `quantity × price` (calculated, not directly in table)
- `type` = `'buy'`

---

**Withdrawal PDFs (all 6 use identical format):**

One block per sale:
```
Withdrawal on [Month DD, YYYY]
Settlement Date: DD-Mon-YYYY
Market Price Per Unit: $X.XX USD
Shares Sold: NNN
Gross Proceeds: $X,XXX.XX USD
```

Each block = one SELL transaction:
- `transacted_at` = Settlement Date (e.g. `"23-Sep-2025"`)
- `quantity` = Shares Sold
- `price` = Market Price Per Unit (strip `$` and ` USD`)
- `amount` = Gross Proceeds (strip `$`, commas, ` USD`) — gross, before wire fee and commission
- `type` = `'sell'`
- `notes` = Reference Number (e.g. `"WRCD55BF434-1EE"`)

Each withdrawal PDF may contain multiple withdrawal blocks — parse all of them.

---

**Asset (single, shared across all Employer stock files):**
- `name = "Acme Corp, Inc."`
- `ticker_symbol = "ACME"` (NYSE listed)
- `investment_category_id` = Employer RSU
- `price_source = 'yahoo_finance'`
- `currency_id = USD`
- `financial_institution_id` = Employer stock

---

## Promote Script (`promote-seed.ts`)

Runs only after Arjun has reviewed and approved both staging tables.
Before running: AMFI codes must be filled in for all MF assets in `asset_stage`.

```
1. BEGIN TRANSACTION
2. DELETE existing placeholder investment_transaction rows WHERE source = 'seeded'
3. Upsert asset_stage → asset (match on ticker_symbol for stocks/crypto, name for MFs)
4. INSERT investment_transaction from investment_transaction_stage
   - Resolve asset_id: JOIN asset ON (asset.name = stage.asset_key OR asset.ticker_symbol = stage.asset_key)
   - Resolve person_id: JOIN person ON person.name = stage.person_name
   - Resolve financial_institution_id: JOIN financial_institution ON name = stage.institution_name
   - Resolve currency_id: JOIN currency ON code = stage.currency_code
   - Set: source = 'seeded', is_seed = TRUE, status = 'confirmed'
5. DELETE FROM holding (full rebuild)
6. Recompute holding rows from confirmed investment_transaction (existing service logic)
7. COMMIT
8. DROP TABLE investment_transaction_stage
9. DROP TABLE asset_stage
```

After promotion:
- Run `npm run seed:native-columns` — backfills native USD columns on holding
- Trigger price refresh via API — populates `current_price` / `current_value`

---

## Code Style

```typescript
// All money arithmetic uses Decimal — never parseFloat()
import Decimal from "decimal.js";

const qty = new Decimal(row.quantity);
const price = new Decimal(row.price);
const amount = qty.mul(price);

// node-postgres always gets row type generic
const result = await pool.query<AssetRow>(
  "SELECT id FROM asset WHERE ticker_symbol = $1",
  [tickerSymbol]
);
```

---

## Idempotency Contract

Each parse script must be safe to re-run:

```
1. DELETE FROM asset_stage WHERE platform = '<this_platform>'
2. DELETE FROM investment_transaction_stage WHERE platform = '<this_platform>'
3. Re-insert all rows for this platform from scratch
```

Staging tables have no FK constraints and no unique constraints across platforms,
so a full clear-and-reinsert per platform is the simplest safe strategy.

---

## Boundaries

- **Always do:** Use `Decimal` for all arithmetic. Tag all rows `source = 'seeded'`,
  `is_seed = TRUE`, `status = 'confirmed'`. Log inserted/skipped counts at the end.
- **Ask first:** Adding new `investment_category` values beyond what's already in DB.
  Adding new `price_source` enum values. Changing how holdings are aggregated.
- **Never do:** Use `parseFloat()` or `Number()` on monetary values.
  Run `UPDATE` or `DELETE` on existing confirmed transactions.
  Commit secrets or file paths outside `investments_seed_data/`.

---

## Success Criteria

**Phase 1 — Staging:**
- [ ] Migration 007 runs cleanly; `platform_import_config` has 5 rows; staging tables exist
- [ ] `seed-zerodha.ts`: `investment_transaction_stage` has ~1,650 rows for platform='zerodha'
- [ ] `seed-indmoney.ts`: rows for both Arjun and Priya, platform='indmoney'
- [ ] `seed-coinswitch.ts`: BTC and ETH rows, platform='coinswitch'
- [ ] `seed-paytm-money.ts`: all MF schemes present in `asset_stage`; AMFI codes empty (to be filled)
- [ ] `seed-employer-stock.ts`: RSU vests + option exercise + ESPP buys + 6 withdrawal sells all present
- [ ] Re-running any script clears and rewrites only that platform's rows (idempotent)
- [ ] SELECT COUNT(*) + spot-check dates/amounts in CloudBeaver matches source files

**Phase 2 — Promotion (after Arjun fills AMFI codes and approves staging):**
- [ ] `promote-seed.ts` runs without error inside a single transaction
- [ ] `holding` table shows non-zero quantity for each asset with net positive position
- [ ] `seed-native-columns` runs without error; USD holdings show native cost columns
- [ ] Portfolio dashboard renders without errors and shows real asset names/values
- [ ] `asset_stage` and `investment_transaction_stage` tables no longer exist after promotion

---

## Open Questions

1. **Zerodha aggregation**: Do we want one `investment_transaction` row per order_id
   (aggregated partial fills) or one row per trade_id (each fill separately)?
   → Spec currently says aggregate by order_id.

2. **Priya — Paytm Money**: Need to visually confirm Priya's PDF has the same
   table structure as Arjun's before implementing. Will do when we reach that platform.

3. **AMFI codes (blocker for Paytm Money promotion)**: The 11 scheme codes listed in the
   Paytm Money section above must be provided by Arjun. Will ask when we reach that step.

4. **CoinSwitch price_source**: The DB enum has `'coinmarketcap'` but `AssetPriceService`
   may not implement a coinmarketcap fetch path. Confirm whether crypto price refresh is
   in-scope for this phase or deferred.

5. **Employer stock option exercise (PDF 2) cost basis**: We use Grant Price ($4.25) as `price`
   and Cost of Options ($658.75) as `amount`. The FMV at exercise ($12.88) is noted in
   `notes` only. Confirm this is the right interpretation for cost basis tracking.
