# Personal Finance Tracker — Requirements

> Last updated: 2026-04-22

---

## 1. Project Overview

A private, local-only household finance tracker for two people (Arjun & Priya).
The system ingests bank and investment statements, classifies transactions with AI
assistance, and provides portfolio, expense, and investment reporting. All data stays
on a private machine; there is no cloud sync or multi-user auth.

**Person selection** (Arjun vs Priya) is a UI convenience for data attribution, not a
security boundary. Selection is persisted in `localStorage` and synced into the URL as
`?personId=X`.

---

## 2. Architecture Summary

```
Browser
  │
  ▼
Next.js :3000  (UI only — server + client components)
  │
  ▼
NestJS :3001   (all business logic, validation, DB access)
  │
  ▼
PostgreSQL :5432
```

- **Backend:** NestJS (TypeScript) — port 3001
- **Frontend:** Next.js App Router (TypeScript) — port 3000
- **Database:** PostgreSQL — raw SQL via `node-postgres` + `pgtyped`
- **Dev environment:** Docker Compose (postgres, backend, frontend, cloudbeaver :8978)

---

## 3. Six UI Screens

### Screen 1 — Expense Ingestion
Upload a bank statement (PDF or CSV) for a selected month. Parsed automatically by AI
(Gemini). HITL review follows:

- Toggle between "Bank statement" and "Credit card" modes
- Drag-and-drop or browse upload; display parsed file with transaction count
- Review table: Date · Description · Amount · Category · Who (R/V) · Confidence · Action
  - Confidence indicator: High (green) / Medium (amber) / Low (red)
  - Per-row actions: Confirm · Edit · Exclude
  - Quick actions: "Skip all similar", "Commit N"
- Progress bar: N of M reviewed
- Bottom summary: X confirmed · Y edited · Z excluded · W pending

### Screen 2 — Investment Ingestion
Upload a consolidated investment statement PDF (INDMoney, Zerodha, PayTM Money).

- Drag-and-drop upload; display parsed file with entry count
- Review table: Date · Asset · Platform · Type · Units · Price · Amount · Action
  - Actions: Confirm (pending) · Edit (review) · Done badge (confirmed)
  - Bulk actions: "Review all", "Commit confirmed"
- Progress bar: N of M confirmed

### Screen 3 — Expenses Report
Monthly or YTD expense summary, filterable by month.

- **Top metrics (4-up):** Total spend · Necessary · Fixed · Variable
- **Category breakdown:** Horizontal bar chart, one row per category with spend value
- **Arjun vs Priya:** Horizontal bars — Arjun / Priya / Joint split
- **Budget vs actual:** Progress bars — Necessary / Fixed / Variable with actual vs budget
  (turns red when over budget)
- **All transactions table:** Date · Description · Category · Who · Amount
- Toggle: Monthly / YTD

### Screen 4 — Investments Report
Monthly or YTD investment summary, filterable by month.

- **Top metrics (4-up):** Total invested · US Equity · Mutual Funds · Liquid Funds
- **Monthly trend chart:** Stacked bar chart by asset class across months
- **Investment entries table:** Date · Asset · Platform · Type · Units · Avg price · Amount
- **Deficit / surplus tracker:** Month · Inflow · Expenses · Invested · Surplus/Deficit
  (tracks whether income covered expenses + investments)
- Toggle: Monthly / YTD

### Screen 5 — Portfolio Overview
Current state of the entire portfolio across all platforms.

- **Hero metrics (2-up):** Total portfolio value (large) · Overall XIRR (green, large)
- **Actual vs target allocation:** Horizontal bar per asset class; marker line at target %;
  amber = overweight, blue = underweight
- **By platform cards (grid):** Per-platform card showing: asset type · platform name ·
  current value · XIRR or label (e.g. "Mark-to-market")
- **Rebalancing suggestions:** Tagged alerts — "Overweight: US Equity at 42% vs 40% target"
  and "Underweight: Indian Equity at 18% vs 20% target" with action text

### Screen 6 — Asset Breakup
Per-asset drill-down. Asset selector dropdown at top.

- **Top metrics (4-up):** Current value · Total units held · Avg cost · XIRR
- **Price history chart:** Line chart with buy-lot markers (↑) at each purchase date
- **P&L summary:** Unrealised gain · Absolute return % · Allocation share % of portfolio
- **Purchase history table (lot-wise):** Date · Type · Units · Buy price · Cost ·
  Current value · Lot XIRR

---

## 4. Phase Plan

### Phase 1 — Foundation ✅ Done

**Goal:** Docker Compose, NestJS + Next.js scaffolds, pre-commit hooks, DB schema.

**Deliverables:**
- `docker-compose.yml` — orchestrates postgres :5432, backend :3001, frontend :3000, cloudbeaver :8978
- NestJS scaffold (`backend/`) — TypeScript, ESLint, Prettier
- Next.js scaffold (`frontend/`) — App Router, TypeScript, ESLint, Prettier
- Pre-commit hook (Husky) — Backend Prettier → ESLint → Frontend Prettier → ESLint
- `backend/migrations/001_init.sql` — 4 enums, 15 tables, seed data (persons, currencies,
  platforms, categories, home)
- `backend/migrations/002_investment_v2.sql` — immutable ledger schema: replaces `investment`
  with `investment_transaction` + `holding`; adds `transfer_type` to `expense`; adds
  `subcategory` to `asset`. See ADR-010, ADR-011.
- `backend/.env` — symlink to root `.env` for `migrate:up` / `codegen` from Mac terminal
- `SPEC.md` — full schema spec
- `docs/system.md` — living system documentation
- `docs/decisions/ADR-001` through `ADR-012`

---

### Phase 2 — Portfolio Value View 🔜 Next

**Goal:** Screens 5 (Portfolio Overview) and 6 (Asset Breakup) — current portfolio value,
allocation vs target, per-platform breakdown. Live prices via market APIs.

#### Phase 2a — Portfolio Value (no XIRR)

**Backend:**
- `GET /persons` — list all persons (seed: Arjun, Priya)
- `GET /portfolio/summary?personId=X` — portfolio summary:
  - Total portfolio value (sum of quantity × current price across all confirmed investments)
  - Value and % by asset class
  - Actual vs target allocation (join to `portfolio_allocation_target`)
  - By-platform breakdown with current value per platform
- `asset-price` service — fetches live price per asset using `price_source`:
  - `yahoo_finance` → **Finnhub** (Indian + US equities, ETFs, gold ETFs)
    - Endpoint: `GET https://finnhub.io/api/v1/quote?symbol={ticker}&token={key}`
    - Price field: `c` (current price)
    - Free tier: 60 req/min
  - `amfi` → **mfapi.in** (Indian mutual fund NAVs)
    - Endpoint: `GET https://api.mfapi.in/mf/{schemeCode}/latest`
    - Price field: `data[0].nav`
    - Free tier: unlimited, no API key
  - `coinmarketcap` → **CoinGecko** (crypto — Bitcoin, Ethereum)
    - Endpoint: `GET https://api.coingecko.com/api/v3/simple/price?ids={id}&vs_currencies=inr`
    - Price field: `{id}.inr`
    - Free tier: ~30 req/min, no API key
  - `manual` → price stored directly on `asset` table or entered manually; no API call
  - Gold spot price → **Metals-API** (XAU/USD) or fallback to a gold ETF ticker via Finnhub
  - In-memory cache keyed on `(asset_id, date)` — TTL 5 min — to avoid hammering APIs on
    every page load

**Frontend:**
- Portfolio Overview page (Screen 5) — server component, `personId` from `searchParams`
  - Hero: Total value + Overall XIRR placeholder ("—" until Phase 2b)
  - Allocation chart (actual vs target bars with marker)
  - Platform cards grid
  - Rebalancing suggestions (derived from over/under vs target)
- Asset Breakup page (Screen 6) — server component + client asset-selector dropdown
  - Top metrics: Current value · Units held · Avg cost · XIRR placeholder
  - P&L summary (no price history chart yet — deferred to Phase 6)
  - Lot table (no lot XIRR yet — Phase 2b)

#### Phase 2b — XIRR

**Backend:**
- Add XIRR computation to `portfolio` service:
  - Per asset: cashflows = each buy lot (–cost, date) + terminal cashflow (+current value, today)
  - Portfolio-wide: aggregate all cashflows across all assets
  - Use `xirr` npm package or implement Newton-Raphson iteration
- `GET /portfolio/summary` extended with `xirr` fields (overall + per asset class)
- `GET /assets/:id/summary?personId=X` extended with lot-wise XIRR

**Frontend:**
- Portfolio Overview: fill in XIRR metric (was "—" in Phase 2a)
- Asset Breakup: fill in XIRR metric + lot-wise XIRR column
- Platform cards: fill in XIRR per platform

**Environment variables added in Phase 2:**
```
FINNHUB_API_KEY=...
METALS_API_KEY=...
# CoinGecko needs no key
```

---

### Phase 3 — Statement Ingestion (Screens 1 & 2)

**Goal:** Upload bank / credit card / investment PDFs → AI parse → HITL review → commit to DB.

**Deliverables:**
- File upload endpoint (NestJS multipart) — stores file, triggers parse job
- AI parsing service — calls Claude API with PDF content, returns structured rows
  (date, description, amount, suggested category, confidence, suggested person)
- HITL review API:
  - `GET /ingestion/:jobId/rows` — pending rows for review
  - `PATCH /ingestion/:jobId/rows/:rowId` — edit a row (category, person, amount)
  - `POST /ingestion/:jobId/rows/:rowId/confirm`
  - `POST /ingestion/:jobId/rows/:rowId/exclude`
  - `POST /ingestion/:jobId/commit` — writes confirmed rows to `expense` / `income` /
    `investment` with `status = 'confirmed'`
- Expense Ingestion page (Screen 1):
  - Upload area, file display, HITL table with per-row actions
  - Progress bar, bulk actions ("Skip all similar", "Commit N")
  - Confidence dots (green / amber / red)
- Investment Ingestion page (Screen 2):
  - Upload area, file display, HITL table
  - Confirm / Edit / Done actions per row

---

### Phase 4 — Expense Reporting (Screen 3)

**Goal:** Monthly and YTD expense reporting with category breakdown, per-person attribution,
and budget vs actual.

**Deliverables:**
- `GET /expenses/summary?personId=X&month=YYYY-MM&view=monthly|ytd`
  - Totals: total spend, necessary, fixed, variable
  - Category breakdown (amount per category, % of total)
  - Per-person split (Arjun / Priya / Joint)
  - Budget vs actual per spend bucket (joins `expense_category_baseline`)
- `GET /expenses/transactions?personId=X&month=YYYY-MM` — paginated transaction list
- Expense Report page (Screen 3):
  - Month selector + Monthly/YTD toggle
  - 4-up metrics
  - Category bar chart
  - Arjun vs Priya bars
  - Budget vs actual bars (red when over)
  - All transactions table

---

### Phase 5 — Investment Reporting (Screen 4)

**Goal:** Monthly and YTD investment totals by asset class, investment entries table,
deficit/surplus tracker.

**Deliverables:**
- `GET /investments/summary?personId=X&month=YYYY-MM&view=monthly|ytd`
  - Total invested this month
  - Breakdown by asset class
  - Monthly trend data (last 12 months) for stacked bar chart
- `GET /investments/transactions?personId=X&month=YYYY-MM` — investment entries for month
- `GET /investments/surplus?personId=X` — month-by-month: inflow / expenses / invested /
  surplus-or-deficit (joins `income`, `expense`, `investment_transaction`, `income_baseline`)
- Investments Report page (Screen 4):
  - Month selector + toggle
  - 4-up metrics
  - Stacked bar chart placeholder (chart lib TBD)
  - Investment entries table
  - Deficit / surplus tracker table

---

### Phase 6 — Intelligence Layer

**Goal:** Projection engine, rebalancing suggestions (automated), price history charting,
agentic insights surfaced via Claude.

**Deliverables (tentative):**
- Price history snapshots table — daily job stores (asset_id, date, price) for charting
- Price history chart on Asset Breakup page (Screen 6) — line chart with buy markers
- Projection engine: given current savings rate and allocation, project portfolio value
  at target date
- Rebalancing engine: compute exact amounts to buy/sell per asset class to reach target
  allocation (currently a simple text suggestion on Screen 5; this makes it precise)
- Agentic insights: Claude-powered natural language summaries
  - "You're on track to hit ₹2 Cr by 2028"
  - "Your variable spend is 22% higher than the 3-month average"
- Lot-wise XIRR on Asset Breakup (may move to Phase 2b)
- Tax harvesting suggestions (LTCG / STCG awareness)

---

## 5. Price API Reference

| Asset class | API | Endpoint | Key required | Free limit | Notes |
|---|---|---|---|---|---|
| Indian equities + ETFs (NSE) | Finnhub | `/api/v1/quote?symbol={TICKER}.NS` | Yes | 60 req/min | `price_source = yahoo_finance`; `.NS` suffix = INR price |
| US equities (NYSE/NASDAQ) | Finnhub | `/api/v1/quote?symbol={TICKER}` | Yes | 60 req/min | No suffix = USD → convert via Frankfurter |
| Indian mutual funds | mfapi.in | `/mf/{amfiCode}/latest` | No | Unlimited | `price_source = amfi`; `ticker_symbol` = AMFI scheme code |
| Bitcoin, Ethereum, Solana | CoinGecko | `/api/v3/simple/price?ids={id}&vs_currencies=inr` | No | ~30 req/min | `price_source = coinmarketcap`; `ticker_symbol` = CoinGecko id |
| Physical gold (spot XAU) | Metals-API | `/api/latest?symbols=XAU&base=USD` | Yes | Varies | `price_source = metals_api`; convert XAU/USD → INR |
| USD/INR rate | Frankfurter | `/latest?from=USD&to=INR` | No | Unlimited | Shared by all USD-priced assets; TTL 1h |
| EPF, Gratuity, Diamond, etc. | — | — | — | — | `price_source = manual`; value updated directly in `holding` |

**Caching:** In-memory cache (TTL 5 min) keyed on `(asset_id, date)` — added in front of all
API calls to avoid hitting rate limits on page load.

---

## 6. Key Technical Conventions

- **Money:** `NUMERIC(18,4)` in SQL — never `FLOAT`. JS arithmetic via `decimal.js`.
- **Quantities:** `NUMERIC(18,8)`.
- **`NUMERIC` from node-postgres comes back as a JS string** — always wrap with `new Decimal()`.
- **Month columns:** `DATE` stored as first day of month (`2025-01-01`).
- **Reports always filter** `WHERE status = 'confirmed'` — omitting this is a silent bug.
- **All business logic in NestJS** — never in Next.js server actions or API routes.
- **`personId` flows via URL** (`?personId=X`); server components read from `searchParams`.
- **Database names:** `snake_case` only — no camelCase in SQL.
