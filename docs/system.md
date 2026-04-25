# System Documentation — Personal Finance Tracker

> Last updated: 2026-04-25 (session 4 — Phase 2a backend + frontend built; blocked on Docker env vars)
> Update this file at the end of every session via `/end-session` after verifying changes.

---

## 1. Project Aim

A private, local-only household finance tracker for two people (Arjun & Priya).
The system ingests bank and investment statements, classifies transactions with AI
assistance, and provides portfolio, expense, and investment reporting.

No authentication — this is a personal tool running inside Docker on a private machine.
Person selection (Arjun vs Priya) is a UI convenience for data attribution, not a
security boundary.

---

## 2. Planned Phases

| Phase | Status    | Description |
|-------|-----------|-------------|
| 1 — Foundation        | ✅ Done   | Docker Compose, NestJS + Next.js scaffolds, pre-commit hooks |
| 1b — DB Schema        | ✅ Done   | `001_init.sql` + `002_investment_v2.sql`: all enums, tables, seed data |
| 2a — Portfolio view   | 🔄 In Progress | Portfolio overview, allocation vs target, live prices — blocked on Docker env vars |
| 2b — XIRR             | Pending   | XIRR per portfolio, asset class, lot |
| 3 — Statement ingestion | Pending | Upload PDF/CSV → Claude AI parse → HITL review → commit |
| 4 — Expense reporting | Pending   | Monthly + YTD views, budget vs actual, per-person attribution |
| 5 — Investment reporting | Pending | Monthly invested by asset class, deficit/surplus tracker |
| 6 — Intelligence layer | Pending  | Projections, rebalancing suggestions, agentic insights |

---

## 3. Tech Stack

| Layer      | Technology                              | Port  |
|------------|-----------------------------------------|-------|
| Backend    | NestJS (TypeScript)                     | 3001  |
| Frontend   | Next.js App Router (TypeScript)         | 3000  |
| Database   | PostgreSQL                              | 5432  |
| DB GUI     | CloudBeaver                             | 8978  |
| Runtime    | Docker Compose (all four services)      | —     |

**Key libraries:**
- `node-postgres` (`pg`) — raw SQL queries, no ORM
- `pgtyped` — generates TypeScript types from SQL queries
- `decimal.js` — all monetary arithmetic (never `parseFloat` on NUMERIC columns)

---

## 4. Architecture

```
Browser
  │
  ▼
Next.js :3000  (UI only — server + client components)
  │  server components: fetch() via Docker-internal http://backend:3001
  │  client components: fetch() via http://localhost:3001
  ▼
NestJS :3001   (all business logic, validation, DB access)
  │
  ▼
PostgreSQL :5432
```

**Rules:**
- All business logic lives in NestJS — never in Next.js server actions or API routes
- No direct DB access from the frontend ever
- Server components read `personId` from `searchParams` prop (not localStorage)
- Every link between pages must preserve `?personId=X`

**NestJS module pattern:**
```
src/<domain>/
  <domain>.module.ts
  <domain>.controller.ts   — HTTP layer only
  <domain>.service.ts      — DB queries + business logic
  dto/
    create-<domain>.dto.ts
```

`DatabaseModule` is `@Global()` — its `DB_POOL` (pg.Pool) is injectable everywhere
without re-importing.

---

## 5. Data Model

> Status: ✅ Verified — `001_init.sql` applied and round-trip tested (migrate:up → down → up) on 2026-04-20.

### 5.1 Enums

| Enum                           | Values                                                              |
|--------------------------------|---------------------------------------------------------------------|
| `transaction_status`           | `pending`, `confirmed`, `edited`, `excluded`                        |
| `ledger_statement_type`        | `savings_account`, `credit_card`                                    |
| `income_type`                  | `salary`, `bonus`, `savings_interest`                               |
| `price_source`                 | `yahoo_finance`, `amfi`, `coinmarketcap`, `gold_api`, `manual`      |
| `investment_transaction_type`  | `buy`, `sell`, `dividend`                                           |
| `investment_transaction_source`| `manual`, `seeded`, `imported`                                      |
| `expense_transfer_type`        | `investment_platform`, `household_member`, `own_account`            |

Note: `metals_api` was replaced by `gold_api` in migration `004_replace_metals_api_with_gold_api` (ADR-013).

`income_type` is designed to grow via `ALTER TYPE ... ADD VALUE`.

### 5.2 Reference / lookup tables

**`home`** — household entity grouping persons
- `id`, `name`

**`person`** — Arjun & Priya
- `id`, `name`, `home_id → home`

**`currency`** — INR and USD at launch
- `id`, `code` (UNIQUE), `symbol`

**`financial_institution`** — banks and investment platforms in one table
- `id`, `name` (UNIQUE)
- Covers: HDFC Bank, Axis Bank, ICICI Bank, Zerodha, INDMoney, PayTM Money,
  CoinSwitch, Kuvera, Groww, Employer stock

**`expense_category`** — with display priority
- `id`, `name` (UNIQUE), `priority INT`

**`investment_category`** — asset class taxonomy
- `id`, `name` (UNIQUE)
- Values: US Equity, Indian Equity, Mutual Fund, ETF, Crypto, RSU, Liquid Fund,
  Gold, Fixed Deposit, PPF / NPS

**`asset`** — one row per investable instrument
- `id`, `name`, `investment_category_id`, `ticker_symbol`, `exchange`,
  `price_source`, `currency_id`, `subcategory`
- `ticker_symbol`, `exchange`, `price_source`, `subcategory` nullable
- `subcategory` provides finer classification within a category (e.g. `LARGECAP`, `FLEXICAP`, `INDEXFUND`, `INTL_EQUITY`)

### 5.3 Statement tables

**`ledger_statement`** — one per uploaded bank / credit card PDF or CSV
- `id`, `person_id`, `financial_institution_id`, `type` (ledger_statement_type),
  `start_date`, `end_date`, `file_url`

**`investment_statement`** — one per uploaded investment statement; one per category
- `id`, `person_id`, `financial_institution_id`, `investment_category_id`,
  `start_date`, `end_date`, `file_url`

### 5.4 Transaction tables

**`expense`**
- `id`, `person_id`, `category_id`, `ledger_statement_id` (nullable — manual entries),
  `amount NUMERIC(18,4)`, `currency_id`, `date`, `description`, `status`, `transfer_type`
- `transfer_type` (`expense_transfer_type`) — NULL for regular expenses; set by AI parser
  when a transfer to an investment platform, household member, or own account is detected.
  Transfers are confirmed as `status = 'excluded'` and never appear in expense reports.
  See ADR-011.

**`income`**
- `id`, `person_id`, `ledger_statement_id` (nullable), `date` (exact transaction date),
  `type` (income_type), `amount NUMERIC(18,4)`, `currency_id`, `description`, `status`

**`investment_transaction`** — immutable ledger, never UPDATE or DELETE (replaces `investment`)
- `id`, `asset_id`, `person_id`, `financial_institution_id`, `investment_statement_id` (nullable),
  `type` (investment_transaction_type: buy/sell/dividend), `quantity NUMERIC(18,8)`,
  `price NUMERIC(18,4)`, `amount NUMERIC(18,4)` (quantity × price), `currency_id`,
  `transacted_at DATE`, `status`, `is_seed BOOLEAN`, `source` (investment_transaction_source),
  `notes`, `created_at`
- Every BUY and SELL is a new row — partial sells work correctly
- `is_seed = TRUE` and `source = 'seeded'` for inception-date seed rows (see ADR-012)
- All XIRR inputs are derived from this table. See ADR-010.

**`holding`** — derived state, household-wide (no `person_id`)
- `id`, `asset_id` (UNIQUE), `quantity NUMERIC(18,8)`, `avg_cost NUMERIC(18,4)`,
  `total_invested NUMERIC(18,4)`, `current_price NUMERIC(18,4)`, `current_value NUMERIC(18,4)`,
  `updated_at`
- Recomputed from `investment_transaction WHERE status = 'confirmed'` after every confirmation
- `current_price` and `current_value` updated separately by price refresh
- Not a ledger — safe to delete and recompute at any time. See ADR-010.

### 5.5 Baseline / target tables

**`income_baseline`** — expected monthly income per person (for surplus calculation)
- `id`, `person_id`, `month DATE` (first of month), `type` (income_type),
  `amount NUMERIC(18,4)`

**`expense_category_baseline`** — monthly budget per category per person
- `id`, `category_id`, `person_id`, `month DATE` (first of month),
  `amount NUMERIC(18,4)`

**`portfolio_allocation_target`** — yearly target allocation % per asset class
- `id`, `investment_category_id`, `start_date DATE`, `end_date DATE`
  (financial year range, e.g. 2026-04-01 → 2027-03-31),
  `target_percentage NUMERIC(5,2)`

### 5.6 Key constraints and conventions

- Money: `NUMERIC(18,4)` — never FLOAT
- Quantities: `NUMERIC(18,8)`
- `NUMERIC` comes back as JS strings from node-postgres — use `decimal.js`
- Month columns: `DATE` stored as first of month (e.g. `2026-04-01`)
- All reporting queries must filter `WHERE status = 'confirmed'`
- `ledger_statement_id` and `investment_statement_id` are nullable to allow
  manual entry without an uploaded statement

### 5.7 Entity relationship summary

```
home
 └── person (many)
      ├── ledger_statement (many)        →  financial_institution
      │    ├── expense (many)            →  expense_category, currency
      │    │   [transfer_type nullable]
      │    └── income (many)             →  currency
      ├── investment_statement (many)    →  financial_institution, investment_category
      │    └── investment_transaction (many) → asset → investment_category, currency
      │                                     → financial_institution
      │                                     → currency (trade currency)
      │        [is_seed, source, status]
      ├── income_baseline (many)
      ├── expense_category_baseline (many) → expense_category
      └── portfolio_allocation_target (per investment_category, per FY range)

asset (1) ──→ holding (1, household-wide derived state)
```

---

## 6. API Endpoints

### Portfolio module (`/portfolio`)

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| GET | `/portfolio/summary` | `personId` | Total value, byAssetClass (% + delta vs target), byPlatform, rebalancing suggestions |
| GET | `/portfolio/assets` | `personId` | List of assets held by person (id, name, assetClass, platform) |
| GET | `/portfolio/assets/:assetId` | `personId` | Asset detail: metrics + lot table |
| POST | `/portfolio/holdings/refresh` | — | Fetches live prices for all non-manual assets, writes to `holding.current_price` |

---

## 7. UI Screens

Six screens planned (wireframes at `wireframes.html`):

1. **Expense ingestion** — upload bank/credit card PDF, HITL review with confirm/edit/exclude per row
2. **Investment ingestion** — upload investment statement PDF, HITL review
3. **Expenses report** — monthly/YTD spend, category breakdown, Arjun vs Priya, budget vs actual
4. **Investments report** — monthly totals by asset class, investment entries table, deficit/surplus tracker
5. **Portfolio overview** — total value, XIRR, actual vs target allocation, by-platform cards, rebalancing suggestions
6. **Asset breakup** — per-asset drill-down: lots, price history, P&L, lot-wise XIRR

Portfolio values (current price, unrealised gain, XIRR) are computed at runtime by
fetching live prices — no price snapshot table in the schema.

---

## 8. ADR Index

| ADR     | Title                                                                            |
|---------|----------------------------------------------------------------------------------|
| ADR-001 | Monorepo with two independent apps (NestJS + Next.js)                            |
| ADR-002 | No ORM — raw SQL via node-postgres with pgtyped for type safety                  |
| ADR-003 | No auth — personId via localStorage and URL parameter                            |
| ADR-004 | Staging via status enum on main tables, not separate staging tables              |
| ADR-005 | Money as NUMERIC(18,4), quantities as NUMERIC(18,8) — never FLOAT               |
| ADR-006 | Docker Compose as the sole development environment                               |
| ADR-007 | Portfolio values computed at runtime via live price fetching — no snapshot table |
| ADR-008 | Price API choices (Finnhub, mfapi.in, CoinGecko, Metals-API, Frankfurter) — partially superseded by ADR-013 |
| ADR-009 | In-memory price cache (Map, TTL 5 min, no Redis in Phase 2a)                    |
| ADR-010 | Immutable ledger pattern: investment_transaction + holding replaces investment   |
| ADR-011 | Internal transfer detection via transfer_type on expense                        |
| ADR-012 | Portfolio inception date seeding strategy (April 1, 2026)                       |
| ADR-013 | Replace Metals-API with GoldAPI for physical gold pricing                       |
