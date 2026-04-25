# SPEC — Native Currency Holdings Display

> Status: Draft — 2026-04-25
> Supersedes: Phase 2b spec (complete)

---

## 1. Objective

The `holding` table currently stores all monetary values (`avg_cost`, `total_invested`,
`current_price`, `current_value`) exclusively in INR. For US equity holdings, this means
the UI can only show ₹-denominated figures even though the assets were purchased in USD.

This feature adds five native-currency columns to `holding` so that the portfolio UI can
display USD-denominated prices and costs alongside INR equivalents for US equity holdings.
All other asset classes are INR-native; they are unaffected (native columns remain NULL).

Target users: Arjun and Priya (household portfolio view).

---

## 2. Acceptance Criteria

### Step 1 — Migration 006: add native columns to `holding`

- [ ] `holding` has five new nullable columns:
  `native_currency VARCHAR(3)`,
  `native_avg_cost NUMERIC(18,4)`,
  `native_total_invested NUMERIC(18,4)`,
  `current_price_native NUMERIC(18,4)`,
  `current_value_native NUMERIC(18,4)`
- [ ] Existing rows are not modified by the migration (all five columns start NULL)

### Step 2 — Seed script: backfill `native_avg_cost`, `native_total_invested`, `native_currency`

- [ ] Script `backend/scripts/seed-native-columns.ts` exists and is idempotent
- [ ] For each holding whose confirmed transactions are in USD (currency.code = 'USD'):
  - `native_currency` = `'USD'`
  - `native_avg_cost` = net USD cost ÷ net quantity (using `investment_transaction.amount`)
  - `native_total_invested` = net USD cost (using `investment_transaction.amount`)
- [ ] INR-denominated holdings are left with NULL in all five native columns
- [ ] `npm run seed:native-columns` script entry added to `backend/package.json`
- [ ] After running the script on real data, US equity holdings show plausible USD values
  (e.g. avg_cost in the range $5–$200 for typical US stocks)

### Step 3 — Price refresh: populate `current_price_native` and `current_value_native`

- [ ] `AssetPriceService` exposes a method `batchFetchFinnhubWithNative()` that returns both
  the USD price and the INR price for each US equity asset
- [ ] `refreshHoldingPrices()` calls the new method for Finnhub assets and writes:
  - `current_price_native` = raw USD price from Finnhub
  - `current_value_native` = `current_price_native × quantity`
  - `native_currency` = `'USD'` (idempotent re-write on each refresh)
- [ ] INR-priced assets are unaffected; their native columns remain NULL after refresh

### Step 4 — API: expose native fields in responses

- [ ] `GET /portfolio/assets/:assetId` response includes:
  - `nativeCurrency: string | null`
  - `nativeAvgCost: string | null`
  - `nativeTotalInvested: string | null`
  - `currentPriceNative: string | null`
  - `currentValueNative: string | null`
- [ ] For INR assets all five fields are `null`
- [ ] For US equities all five are non-null after a price refresh has run

### Step 5 — Frontend: show native values in Asset Breakup

- [ ] Asset Breakup metrics card shows native currency value alongside INR for:
  - Current Value: "$X.XX / ₹Y.YY"
  - Avg Cost: "$X.XX / ₹Y.YY"
  - Total Invested (in the lot table cost column): "$X.XX / ₹Y.YY"
- [ ] When `nativeCurrency` is null (INR assets), only the ₹ figure is shown — layout unchanged
- [ ] `currentPriceNative` exposed in the API response (used to compute lot `currentValueNative`
  client-side if needed, or included per-lot if the backend computes it)
- [ ] `AssetDetail` and `LotEntry` types in `src/types/index.ts` are updated

### ADR

- [ ] ADR-018 written: native-currency columns on `holding`

---

## 3. Data Model Changes

### Migration `006_native_currency_columns.sql`

```sql
-- Up Migration
ALTER TABLE holding
  ADD COLUMN IF NOT EXISTS native_currency        VARCHAR(3),
  ADD COLUMN IF NOT EXISTS native_avg_cost        NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS native_total_invested  NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS current_price_native   NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS current_value_native   NUMERIC(18,4);

-- Down Migration
ALTER TABLE holding
  DROP COLUMN IF EXISTS native_currency,
  DROP COLUMN IF EXISTS native_avg_cost,
  DROP COLUMN IF EXISTS native_total_invested,
  DROP COLUMN IF EXISTS current_price_native,
  DROP COLUMN IF EXISTS current_value_native;
```

All five columns are nullable. INR assets will always have NULL here; only USD assets
are populated.

---

## 4. Seed Script — `backend/scripts/seed-native-columns.ts`

Determines native currency per asset from `investment_transaction.currency_id`:

```sql
SELECT
  it.asset_id,
  c.code                                                               AS currency_code,
  SUM(CASE WHEN it.type = 'buy' THEN it.quantity  ELSE -it.quantity  END) AS net_qty,
  SUM(CASE WHEN it.type = 'buy' THEN it.amount    ELSE -it.amount    END) AS net_native_amount
FROM investment_transaction it
JOIN currency c ON c.id = it.currency_id
WHERE it.status = 'confirmed'
GROUP BY it.asset_id, c.code
HAVING SUM(CASE WHEN it.type = 'buy' THEN it.quantity ELSE -it.quantity END) > 0
```

For each row where `currency_code = 'USD'`:

```sql
UPDATE holding SET
  native_currency       = 'USD',
  native_avg_cost       = $net_native_amount / $net_qty,
  native_total_invested = $net_native_amount
WHERE asset_id = $asset_id;
```

INR assets: leave all native columns NULL (or explicitly SET to NULL for idempotency).

Script uses `decimal.js` for the division; never `parseFloat`.

---

## 5. Backend Changes

### 5.1 `asset-price.service.ts` — new method

Add `batchFetchFinnhubWithNative()`:

```typescript
type FinnhubResult = { priceInr: Decimal; priceUsd: Decimal };

async batchFetchFinnhubWithNative(
  assets: AssetPriceRow[],
): Promise<Map<number, FinnhubResult | null>>
```

- Calls Finnhub sequentially with 1000ms sleep (same as existing `batchFetchFinnhub`)
- Returns both the raw USD price (`data.c`) and the INR-converted price (`data.c × usdToInr`)
- Existing `batchFetchFinnhub` is kept unchanged (used by `batchFetchYahooFinancePrices`)
- `batchFetchYahooFinancePrices` is also kept unchanged — it returns INR-only Map for non-refresh use

### 5.2 `portfolio.service.ts` — `refreshHoldingPrices()`

Replace the Finnhub path with `batchFetchFinnhubWithNative()`:

```typescript
const finnhubResults = await this.assetPriceService.batchFetchFinnhubWithNative(usAssets);

// When writing to DB for Finnhub assets:
await this.pool.query(
  `UPDATE holding SET
     current_price        = $1,
     current_value        = $1::numeric * quantity,
     current_price_native = $2,
     current_value_native = $2::numeric * quantity,
     native_currency      = 'USD'
   WHERE asset_id = $3`,
  [result.priceInr.toFixed(4), result.priceUsd.toFixed(4), assetId],
);
```

Non-Finnhub assets (INR sources) continue to write only `current_price` and `current_value`.

### 5.3 `portfolio.service.ts` — `getAssetDetail()`

Extend `HoldingRow` type and the SQL query to include the five new columns:

```sql
SELECT
  ...existing columns...,
  h.native_currency,
  h.native_avg_cost::text,
  h.native_total_invested::text,
  h.current_price_native::text,
  h.current_value_native::text
FROM holding h
JOIN asset a ON a.id = h.asset_id
WHERE h.asset_id = $1
```

Return the five fields in the `getAssetDetail()` response:

```typescript
{
  ...existing fields...,
  nativeCurrency: h.native_currency ?? null,
  nativeAvgCost: h.native_avg_cost ?? null,
  nativeTotalInvested: h.native_total_invested ?? null,
  currentPriceNative: h.current_price_native ?? null,
  currentValueNative: h.current_value_native ?? null,
}
```

No changes to `getSummary()` or `queryPositions()` — the portfolio overview continues to
show INR totals only; native values are only relevant at the per-asset detail level.

---

## 6. Frontend Changes

### 6.1 `src/types/index.ts`

Add to `AssetDetail`:

```typescript
nativeCurrency: string | null;
nativeAvgCost: string | null;
nativeTotalInvested: string | null;
currentPriceNative: string | null;
currentValueNative: string | null;
```

Add to `LotEntry`:

```typescript
costNative: string | null;          // it.amount in USD; null for INR assets
currentValueNative: string | null;  // current_price_native × units; null for INR assets
```

### 6.2 `portfolio/assets/[assetId]/page.tsx`

In the 4-up metrics card:

- **Current Value**: if `nativeCurrency` is non-null, render `"$X.XX / ₹Y.YY"`;
  otherwise render `"₹Y.YY"` as today
- **Avg Cost**: same pattern using `nativeAvgCost` / `avgCost`

In the UI transaction rows (from `getAssetDetail().lots`):
- **Cost** column: if `costNative` non-null, show `"$X.XX / ₹Y.YY"` using `costNative` / `cost`
- **Current Value** column: if `currentValueNative` non-null, show `"$X.XX / ₹Y.YY"`
  using `currentValueNative` / `currentValue`

The lot response from `getAssetDetail()` already includes `cost` (INR, `amount_inr`).
The backend should also include per lot:
- `costNative: string | null` — `it.amount` (native USD) for USD assets; null for INR assets
- `currentValueNative: string | null` — `current_price_native × lot.quantity`; null for INR assets

Add `amount::text` to the `LotRow` SQL query and extend the lot mapper in `getAssetDetail()`
to compute `costNative` and `currentValueNative` using `decimal.js`.

### 6.3 Formatting helper

Add `formatNativeAndInr(native: string, nativeCurrency: string, inr: string): string`
to the frontend formatters, producing e.g. `"$12.34 / ₹1,045.20"`.

---

## 7. Code Style

Follows CLAUDE.md conventions:
- Semicolons; double quotes; 2-space indent; trailing commas; 100-char line width
- `NUMERIC` columns from pg come back as JS strings — use `decimal.js` for arithmetic
- Money in `NUMERIC(18,4)` SQL — never FLOAT
- Floating promises: `void fn()` at call sites
- No comments except for non-obvious WHY

---

## 8. Testing Strategy

### Unit tests

**`asset-price.service.spec.ts`**
- `batchFetchFinnhubWithNative`: assert result contains both `priceInr` and `priceUsd`
  for a successful fetch; assert `null` on HTTP error

**`portfolio.service.spec.ts`**
- `refreshHoldingPrices`: when Finnhub returns a result, assert DB UPDATE includes
  `current_price_native` and `current_value_native`
- `getAssetDetail` for a USD asset: assert `nativeCurrency = 'USD'` and `nativeAvgCost` non-null
- `getAssetDetail` for an INR asset: assert all five native fields are null

### Manual verification (post-migration + seed)

```sql
-- US equities: native_avg_cost should be in USD range (~5–200), native_currency = 'USD'
SELECT a.name, h.avg_cost, h.native_avg_cost, h.native_currency
FROM holding h
JOIN asset a ON a.id = h.asset_id
JOIN investment_category ic ON ic.id = a.investment_category_id
WHERE ic.name = 'US Equity';

-- INR assets: all native columns should be NULL
SELECT a.name, h.native_currency, h.native_avg_cost
FROM holding h
JOIN asset a ON a.id = h.asset_id
JOIN investment_category ic ON ic.id = a.investment_category_id
WHERE ic.name != 'US Equity'
  AND (h.native_currency IS NOT NULL OR h.native_avg_cost IS NOT NULL);
-- Expected: 0 rows
```

- After `POST /portfolio/holdings/refresh`: US equity holdings have non-null
  `current_price_native` and `current_value_native` in DB
- Asset Breakup page for a US equity (e.g. AAPL): shows both `$X.XX` and `₹Y.YY` for
  Current Value and Avg Cost
- Asset Breakup page for an Indian equity (e.g. HDFCBANK): shows only `₹Y.YY` — no change

---

## 9. ADRs to Write

- **ADR-018** — Native-currency columns on `holding`: why five separate columns vs. compute
  on the fly (Option B was rejected); why native columns are NULL for INR assets (not redundant
  copies); why `native_avg_cost`/`native_total_invested` come from `investment_transaction.amount`
  (original USD) rather than dividing `avg_cost` by current rate.

---

## 10. Boundaries

### Always do
- Filter `WHERE status = 'confirmed'` on every `investment_transaction` query
- Use `decimal.js` for all arithmetic on NUMERIC values from pg
- Keep native columns NULL for INR-denominated assets (do not store redundant INR copies)
- Use `investment_transaction.amount` (original USD) for `native_avg_cost`/`native_total_invested`,
  not a back-calculated value from `avg_cost ÷ current_rate`
- Write `native_currency = 'USD'` on every price refresh for Finnhub assets (idempotent)

### Ask before doing
- Adding native currency support to any asset class other than USD equities
- Changing the portfolio summary endpoint to include native totals
- Any change to `investment_transaction.amount` or `amount_inr` columns

### Never do
- Use `parseFloat()` or native JS arithmetic on NUMERIC columns
- Store native currency values for INR assets (redundant duplication)
- Compute `native_avg_cost` by dividing `avg_cost` by a live exchange rate
  (this would drift whenever the rate changes — use the original transaction amounts)
- Modify existing ADRs — supersede with a new numbered ADR
