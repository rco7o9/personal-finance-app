# Phase 2a Spec — Portfolio Value View (no XIRR)

> Status: Draft — 2026-04-22
> Scope: Backend price-fetching + portfolio API · Next.js app shell · Portfolio Overview + Asset Breakup screens

---

## 1. Objective

Build the live portfolio view for the household finance tracker. At the end of Phase 2a:

- A working app shell (sidebar + top bar with person selector) with placeholder routes for all 6 screens
- **Portfolio Overview** — total household portfolio value in INR, actual vs target allocation, per-platform value cards, rebalancing suggestions
- **Asset Breakup** — per-asset drill-down: current value, units held, average cost, unrealised gain, lot history table

All monetary values are in **INR**. USD-denominated assets (US equities, RSUs) are converted using a live USD/INR exchange rate.

XIRR is explicitly **out of scope** for Phase 2a — all XIRR fields show `"—"` as placeholder text.

---

## 2. In Scope / Out of Scope

### In scope
- App shell: sidebar navigation, top bar, `PersonSelector` client component, `(app)` route group layout
- NestJS `persons` module — `GET /persons`
- NestJS `asset-price` service — live price fetching per `price_source` with in-memory cache
- NestJS `currency` service — live USD→INR rate via Frankfurter API (free, no key required)
- NestJS `portfolio` module — `GET /portfolio/summary`, `GET /portfolio/assets`, `GET /portfolio/assets/:assetId`
- DB migration `002_seed_assets.sql` — populate real `ticker_symbol`, `exchange`, `price_source` on seeded `asset` rows
- Portfolio Overview page (Screen 5 — household-wide, not per-person)
- Asset Breakup page (Screen 6 — asset selector dropdown + lot table)
- ADR-008 (price API decisions) and ADR-009 (in-memory cache strategy)

### Out of scope
- XIRR computation (Phase 2b)
- Price history chart with buy markers (Phase 6)
- Stacked bar chart on Investments Report (Phase 5)
- Statement ingestion (Phase 3)
- Expense / Investment reporting pages (Phase 4/5) — shell nav links exist, pages are stubs
- Authentication or per-user data isolation
- Persistent price cache (Redis) — in-memory only for now

---

## 3. Data Model Changes

### Migration `002_investment_v2.sql` (run as part of this phase)

Four changes in one migration:

1. **Add `subcategory TEXT` to `asset`** — nullable, for finer classification (e.g. `LARGECAP`, `INDEXFUND`, `INTL_EQUITY`)

2. **Add `transfer_type expense_transfer_type` to `expense`** — nullable; set by AI parser for investment platform / household member / own account transfers; NULL for regular expenses. See ADR-011.

3. **Drop `investment` table** — replaced by the two tables below. See ADR-010.

4. **Create `investment_transaction`** — immutable ledger. Every BUY/SELL is a new row. Columns: `asset_id`, `person_id`, `financial_institution_id`, `investment_statement_id` (nullable), `type` (buy/sell/dividend), `quantity`, `price`, `amount`, `currency_id`, `transacted_at`, `status`, `is_seed`, `source`, `notes`, `created_at`.

5. **Create `holding`** — derived state, household-wide. Columns: `asset_id` (UNIQUE), `quantity`, `avg_cost`, `total_invested`, `current_price`, `current_value`, `updated_at`. Recomputed from confirmed `investment_transaction` rows after every confirmation.

### ⚠️ Prerequisites — Manual DB Seeding (TODO for Arjun)

Before Phase 2a implementation can be tested end-to-end, the database must be seeded with real portfolio data. This is a **manual task** to be done directly via CloudBeaver or psql before development begins.

Tables to populate with real values:

- **`asset`** — one row per instrument you hold; must include correct `ticker_symbol`, `exchange`, `price_source`, `investment_category_id`, and `currency_id`
  - Use `price_source = 'yahoo_finance'` for Indian/US equities and ETFs
  - Use `price_source = 'amfi'` for mutual funds (ticker_symbol = AMFI scheme code)
  - Use `price_source = 'coinmarketcap'` for crypto (ticker_symbol = CoinGecko id, e.g. `bitcoin`)
  - Use `price_source = 'manual'` + `ticker_symbol = 'XAU'` for physical gold
  - Indian tickers on NSE need `.NS` suffix (e.g. `HDFCBANK.NS`) so the backend knows price is in INR
- **`investment`** — one row per buy lot; must include `asset_id`, `person_id`, `financial_institution_id`, `quantity`, `price`, `currency_id`, `date`, `status = 'confirmed'`
- **`portfolio_allocation_target`** — target % per `investment_category` for the current FY (2026-04-01 to 2027-03-31); percentages must sum to 100

The price-fetching service and portfolio summary endpoint will not return real data until these rows exist.

> **Convention note:** For Metals-API gold routing — the backend treats any asset row where `price_source = 'manual'` AND `ticker_symbol = 'XAU'` as a physical gold row and calls Metals-API for the spot price. All other `manual` rows return `null` (no price fetch).

---

## 4. Backend

### 4.1 Environment Variables (add to `.env.example`)
```
FINNHUB_API_KEY=          # https://finnhub.io — free, 60 req/min
METALS_API_KEY=           # https://metals-api.com — free tier, for XAU spot price
# Frankfurter, mfapi.in, CoinGecko require no API key
```

### 4.2 `persons` module

```
src/persons/
  persons.module.ts
  persons.controller.ts
  persons.service.ts
```

**Endpoint:** `GET /persons`

Response: `{ id: number, name: string }[]`

Query: `SELECT id, name FROM person ORDER BY id`

---

### 4.3 `currency` service (`src/currency/`)

Provides live USD→INR exchange rate. Used by `portfolio` service when converting USD-priced assets.

**API:** Frankfurter — `https://api.frankfurter.app/latest?from=USD&to=INR`
- Free, no API key, ECB rates updated daily
- Response field: `rates.INR`

**Cache:** In-memory, TTL 1 hour.

**Method:** `getUsdToInr(): Promise<Decimal>`

---

### 4.4 `asset-price` service (`src/asset-price/`)

Fetches current price **in INR** for a given asset row.

**Price source routing:**

| `price_source` | `ticker_symbol` example | API | Price currency | INR conversion |
|---|---|---|---|---|
| `yahoo_finance` | US ticker e.g. `MSFT` | Finnhub `/api/v1/quote` | USD | × USD/INR rate |
| `yahoo_finance` | NSE ticker e.g. `HDFCBANK.NS` | Finnhub `/api/v1/quote` | INR | none |
| `amfi` | AMFI scheme code e.g. `122639` | mfapi.in `/mf/{code}/latest` | INR | none |
| `coinmarketcap` | CoinGecko id e.g. `bitcoin` | CoinGecko `/api/v3/simple/price?ids={id}&vs_currencies=inr` | INR | none |
| `metals_api` | `XAU` | Metals-API `/api/latest?symbols=XAU&base=USD` | USD | × USD/INR rate |
| `manual` | any | No API call — value updated manually in `holding` table | — | — |

**Finnhub `.NS` detection:** If `ticker_symbol` ends with `.NS` or `.BO`, treat price as INR. Otherwise treat as USD and multiply by `getUsdToInr()`.

**In-memory cache:** `Map<assetId, { priceInr: Decimal; fetchedAt: Date }>` — TTL 5 minutes.

**Method:** `getPriceInr(asset: AssetRow): Promise<Decimal | null>`

**Error handling:** Log and return `null` on any API failure. The portfolio service skips assets returning `null` — it never throws a 5xx to the caller due to a price fetch failure.

---

### 4.5 `portfolio` module (`src/portfolio/`)

```
src/portfolio/
  portfolio.module.ts
  portfolio.controller.ts
  portfolio.service.ts
  portfolio.service.spec.ts
  dto/
    portfolio-summary.dto.ts
    asset-detail.dto.ts
```

#### `GET /portfolio/summary`

Household-wide — no `personId` filter (all confirmed investments across both persons).

**Computation steps:**
1. Query `holding` table for all assets with `quantity > 0` (already derived from confirmed transactions)
2. Fetch current price (INR) per distinct asset via `AssetPriceService`
3. `assetValue = net_quantity × priceInr` (using `decimal.js`)
4. `totalValueInr = SUM(assetValue)` across all assets
5. Group by `investment_category.name` → compute `percentage = (categoryValue / total) × 100`
6. Join `portfolio_allocation_target` WHERE today BETWEEN `start_date` AND `end_date` → get `target_percentage` per category
7. `delta = actual% - target%`
8. Rebalancing suggestions: any asset class where `|delta| > 3`
   - `delta > 3` → tag `"overweight"`, message: `"{class} at {actual}% vs {target}% target — consider pausing purchases for 1 month"`
   - `delta < -3` → tag `"underweight"`, message: `"{class} at {actual}% vs {target}% target — ₹{headroom} headroom to reach target"`
9. Group by `financial_institution.name` + `investment_category.name` for platform breakdown

**Response shape:**
```typescript
{
  totalValueInr: string,
  asOf: string,                        // ISO date (today)
  byAssetClass: Array<{
    assetClass: string,
    valueInr: string,
    percentage: number,
    targetPercentage: number | null,
    delta: number | null,
  }>,
  byPlatform: Array<{
    platform: string,
    assetClass: string,
    valueInr: string,
  }>,
  rebalancingSuggestions: Array<{
    tag: "overweight" | "underweight",
    assetClass: string,
    actualPct: number,
    targetPct: number,
    message: string,
  }>,
}
```

#### `GET /portfolio/assets`

List of distinct assets currently held (net_quantity > 0, status = confirmed).

**Response:**
```typescript
{
  assets: Array<{
    id: number,
    name: string,
    assetClass: string,
    platform: string,
  }>
}
```

#### `GET /portfolio/assets/:assetId`

Per-asset detail for the Asset Breakup page.

**Note on avg cost in INR:** Investment rows store `price` in native currency. For USD lots, multiply stored price by current USD/INR rate. This is a known Phase 2a simplification (no historical FX rates stored).

**Response:**
```typescript
{
  asset: { id: number, name: string, assetClass: string },
  currentPriceInr: string,
  totalUnits: string,
  avgCostInr: string,
  currentValueInr: string,
  totalCostInr: string,
  unrealisedGainInr: string,
  absoluteReturnPct: number,
  allocationSharePct: number,
  xirr: null,
  lots: Array<{
    id: number,
    date: string,
    type: "buy",
    units: string,
    buyPriceInr: string,
    costInr: string,
    currentValueInr: string,
    xirr: null,
  }>,
}
```

---

## 5. Frontend

### 5.1 Tech Setup (one-time)
- Install Tailwind CSS + shadcn/ui in `frontend/`
- Install Recharts: `npm install recharts`
- shadcn components needed in Phase 2a: `select`, `table`, `card`, `badge`

### 5.2 App Shell

**Route group:** `src/app/(app)/` — shared layout, no URL path segment added.

**`src/app/(app)/layout.tsx`** — server component wrapping all app pages:
```
<div class="flex h-screen">
  <Sidebar />
  <div class="flex flex-col flex-1">
    <TopBar />
    <main>{children}</main>
  </div>
</div>
```

**Sidebar routes:**
| Label | Route | Status in Phase 2a |
|---|---|---|
| Portfolio | `/portfolio` | Built |
| Ingestion | `/ingestion` | Stub |
| Expenses | `/expenses` | Stub |
| Investments | `/investments` | Stub |

**`Sidebar.tsx`** — `"use client"` (needs `usePathname` for active link). Fixed left panel.

**`TopBar.tsx`** — server component container. Renders `PersonSelector` inside.

**`PersonSelector.tsx`** — `"use client"`.
- On mount: reads `personId` from `localStorage`; if absent, defaults to `1`
- Calls `GET ${NEXT_PUBLIC_API_URL}/persons` to populate options
- On change: writes to `localStorage` + updates URL param via `router.replace`
- Uses shadcn `<Select>`

**Stub pages** (`/ingestion`, `/expenses`, `/investments`): render `<p>Coming soon — Phase N</p>`.

---

### 5.3 Portfolio Overview Page

**`src/app/(app)/portfolio/page.tsx`** — server component.

Fetches: `GET ${API_URL}/portfolio/summary` (Docker-internal URL from server component).

**Sections:**

**1. Hero — 2-column grid**
- Left: "Total Portfolio Value" — formatted as `₹X.XX Cr` — subtitle "As of {date}"
- Right: "Overall XIRR" — displays `"—"` — subtitle "XIRR coming in Phase 2b"

**2. Two-column grid**
- Left — "Actual vs target allocation":
  - Component `<AllocationChart rows={byAssetClass} />`
  - One row per asset class: label (100px) + bar + marker line at target% + actual% label
  - Bar colour: amber if delta > 3, blue if delta < -3, neutral otherwise
- Right — "By platform":
  - 2×N grid of `<PlatformCard>` components
  - Each card: asset class label (small, muted) + platform name + `₹X.XX L/Cr` + XIRR `"—"`

**3. Rebalancing suggestions**
- `<RebalancingSuggestions suggestions={rebalancingSuggestions} />`
- Each row: shadcn `<Badge variant="outline">` (amber/blue) + message text
- Hidden if suggestions array is empty

**Components:**
- `src/components/portfolio/AllocationChart.tsx` — pure Tailwind CSS bars (no Recharts needed here)
- `src/components/portfolio/PlatformCard.tsx`
- `src/components/portfolio/RebalancingSuggestions.tsx`

---

### 5.4 Asset Breakup Page

**`src/app/(app)/portfolio/assets/[assetId]/page.tsx`** — server component.

Fetches (in parallel):
- `GET ${API_URL}/portfolio/assets/${assetId}`
- `GET ${API_URL}/portfolio/assets` (for dropdown options)

**`<AssetSelector>`** — `"use client"`. Uses shadcn `<Select>`. On change → `router.push(/portfolio/assets/${id}?personId=X)`.

**Sections:**

**1. Asset selector** — full width

**2. 4-up metrics grid**
- Current value · Total units · Avg cost · XIRR `"—"`

**3. Two-column grid**
- Left: Price history placeholder — grey dashed box, text "Price history chart — coming in Phase 6"
- Right: P&L summary card
  - Unrealised gain (green if positive, red if negative)
  - Absolute return %
  - Allocation share % of portfolio

**4. Lot table** — shadcn `<Table>`
- Columns: Date · Type · Units · Buy price (INR) · Cost · Current value · Lot XIRR `"—"`

**Components:**
- `src/components/portfolio/AssetSelector.tsx`

---

## 6. Styling Conventions

- All styling via Tailwind utility classes
- Monetary display: `toLocaleString("en-IN")` for Indian number system (lakhs/crores)
- Format helper: values ≥ 1 Cr → `₹X.XX Cr`; values ≥ 1 L → `₹X.XX L`; else `₹X,XXX`
- Colour semantics:
  - Gain / positive: `text-green-600`
  - Loss / negative: `text-red-600`
  - Overweight: `text-amber-600` + amber bar background
  - Underweight: `text-blue-600` + blue bar background

---

## 7. Testing Strategy

### Backend
- `asset-price.service.spec.ts`:
  - Mock HTTP: assert Finnhub called for `yahoo_finance`; mfapi.in for `amfi`; CoinGecko for `coinmarketcap`; Metals-API for XAU
  - Assert USD→INR conversion applied for non-`.NS` tickers
  - Assert `null` returned (no throw) when API fails
- `portfolio.service.spec.ts`:
  - Mock `AssetPriceService`; assert `totalValueInr` computed correctly
  - Assert `byAssetClass` percentages sum to 100
  - Assert overweight suggestion generated when delta > 3
  - Assert underweight suggestion generated when delta < -3
  - Assert no suggestion when all within ±3%
- `portfolio.e2e.spec.ts`:
  - `GET /portfolio/summary` → 200, `totalValueInr` is numeric string
  - `GET /portfolio/assets` → 200, array

### Frontend
- Manual smoke test: `docker compose up`, navigate to `/portfolio`, confirm real prices render

---

## 8. ADRs to Write

- **ADR-008** — Price API choices (Finnhub, mfapi.in, CoinGecko, Metals-API, Frankfurter)
- **ADR-009** — In-memory price cache (Map, TTL 5 min, no Redis in Phase 2a)

---

## 9. Acceptance Criteria

### API
- [ ] `GET /persons` returns Arjun and Priya
- [ ] `GET /portfolio/summary` returns HTTP 200 with non-zero `totalValueInr`
- [ ] `byAssetClass` percentages sum to ~100 (±0.5 rounding tolerance)
- [ ] Rebalancing suggestions empty when all asset classes within ±3% of target
- [ ] `GET /portfolio/assets` returns at least one asset
- [ ] `GET /portfolio/assets/:assetId` returns `xirr: null` and a `lots` array
- [ ] Price fetch failure for one asset does not cause 500 — that asset is skipped

### Frontend
- [ ] App shell renders at `/portfolio` — sidebar + top bar visible
- [ ] `PersonSelector` dropdown shows Arjun and Priya; selection persists in URL + localStorage
- [ ] Stub pages (`/expenses`, `/investments`, `/ingestion`) render without errors
- [ ] Portfolio Overview shows total value formatted as `₹X.XX Cr`
- [ ] Allocation bars render in correct colours (amber/blue/neutral) based on delta
- [ ] Rebalancing suggestions visible when deltas exist in seed data
- [ ] Asset Breakup renders lot table for a selected asset
- [ ] Asset selector navigates to correct URL on change
- [ ] All XIRR fields show `"—"`, not errors or zeros

---

## 10. New Files

```
backend/
  src/
    persons/
      persons.module.ts
      persons.controller.ts
      persons.service.ts
    currency/
      currency.module.ts
      currency.service.ts
    asset-price/
      asset-price.module.ts
      asset-price.service.ts
      asset-price.service.spec.ts
    portfolio/
      portfolio.module.ts
      portfolio.controller.ts
      portfolio.service.ts
      portfolio.service.spec.ts
      dto/
        portfolio-summary.dto.ts
        asset-detail.dto.ts

frontend/
  src/
    app/
      (app)/
        layout.tsx
        portfolio/
          page.tsx
          assets/
            [assetId]/
              page.tsx
        expenses/
          page.tsx
        investments/
          page.tsx
        ingestion/
          page.tsx
    components/
      layout/
        Sidebar.tsx
        TopBar.tsx
        PersonSelector.tsx
      portfolio/
        AllocationChart.tsx
        PlatformCard.tsx
        RebalancingSuggestions.tsx
        AssetSelector.tsx
```
