import { Injectable, Inject } from "@nestjs/common";
import { Pool, PoolClient } from "pg";
import Decimal from "decimal.js";
import {
  AssetPriceService,
  AssetPriceRow,
  FinnhubNativeResult,
} from "../asset-price/asset-price.service";
import { xirr, CashFlow } from "./xirr";

type PositionRow = {
  asset_id: number;
  asset_name: string;
  ticker_symbol: string | null;
  price_source: string | null;
  category_id: number;
  category_name: string;
  platform: string;
  quantity: string;
  total_invested: string;
  current_price: string | null;
  current_value: string | null;
};

type AllocationTargetRow = {
  category_id: number;
  category_name: string;
  target_percentage: string;
  end_date: Date;
};

type HoldingRow = {
  asset_id: number;
  asset_name: string;
  ticker_symbol: string | null;
  price_source: string | null;
  quantity: string;
  avg_cost: string;
  total_invested: string;
  current_price: string | null;
  current_value: string | null;
  native_currency: string | null;
  native_avg_cost: string | null;
  native_total_invested: string | null;
  current_price_native: string | null;
  current_value_native: string | null;
};

type LotRow = {
  id: number;
  date: Date;
  type: string;
  quantity: string;
  price: string;
  amount_inr: string;
  amount: string;
};

type AssetListRow = {
  id: number;
  name: string;
  asset_class: string;
  platform: string;
};

type XirrFlowRow = {
  transacted_at: Date;
  type: string;
  amount_inr: string;
  category_id: number;
};

type TxnRow = {
  type: string;
  quantity: string;
  amount: string;
  amount_inr: string;
};

const SUGGESTION_THRESHOLD = new Decimal("3");
const REFRESH_SLEEP_MS = 1000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

@Injectable()
export class PortfolioService {
  constructor(
    @Inject("DB_POOL") private readonly pool: Pool,
    private readonly assetPriceService: AssetPriceService,
  ) {}

  async getSummary() {
    const [positions, targets, flows, plannedInvestments] = await Promise.all([
      this.queryPositions(),
      this.queryTargets(),
      this.queryXirrFlows(),
      this.queryPlannedInvestments(),
    ]);

    const targetMap = new Map(targets.map((t) => [t.category_id, t]));
    const endDate = targets.length > 0 ? targets[0].end_date : null;

    const totalValue = positions.reduce(
      (sum, p) => (p.current_value ? sum.add(new Decimal(p.current_value)) : sum),
      new Decimal(0),
    );

    const expectedTotal = totalValue.add(plannedInvestments);

    const byAssetClass = this.groupByAssetClass(positions, expectedTotal, targetMap);
    const byPlatform = this.groupByPlatform(positions);

    const today = new Date();
    const overallXirr = this.computePortfolioXirr(flows, totalValue, today);
    const byAssetClassWithXirr = byAssetClass.map((c) => ({
      ...c,
      xirr: this.computeClassXirr(
        flows.filter((f) => f.category_id === c.categoryId),
        new Decimal(c.value),
        today,
      ),
    }));

    const rebalancingSuggestions = byAssetClassWithXirr
      .filter((c) => c.delta !== null && new Decimal(c.delta).abs().gt(SUGGESTION_THRESHOLD))
      .map((c) => {
        const delta = new Decimal(c.delta!);
        const rupeesGap = c.targetAbsoluteValue
          ? new Decimal(c.targetAbsoluteValue).sub(new Decimal(c.value))
          : null;
        return {
          tag: delta.gt(0) ? "overweight" : "underweight",
          assetClass: c.assetClass,
          actualPct: c.percentage,
          targetPct: c.targetPercentage!,
          message: `${c.assetClass} is ${delta.abs().toFixed(2)}% ${delta.gt(0) ? "above" : "below"} target`,
          rupeesGap: rupeesGap ? rupeesGap.toFixed(2) : null,
        };
      });

    return {
      totalValue: totalValue.toFixed(2),
      expectedTotalValue: expectedTotal.toFixed(2),
      plannedInvestments: plannedInvestments.toFixed(2),
      targetEndDate: endDate ? (endDate as unknown as Date).toISOString().slice(0, 10) : null,
      overallXirr,
      byAssetClass: byAssetClassWithXirr,
      byPlatform,
      rebalancingSuggestions,
    };
  }

  async getAssets() {
    const result = await this.pool.query<AssetListRow>(
      `SELECT DISTINCT ON (a.id)
         a.id,
         a.name,
         ic.name AS asset_class,
         fi.name AS platform
       FROM investment_transaction it
       JOIN asset a ON a.id = it.asset_id
       JOIN investment_category ic ON ic.id = a.investment_category_id
       JOIN financial_institution fi ON fi.id = it.financial_institution_id
       WHERE it.status = 'confirmed'
       ORDER BY a.id`,
    );

    return result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      assetClass: r.asset_class,
      platform: r.platform,
    }));
  }

  async getAssetDetail(assetId: number) {
    const [holdingRes, lotsRes] = await Promise.all([
      this.pool.query<HoldingRow>(
        `SELECT
           a.id AS asset_id,
           a.name AS asset_name,
           a.ticker_symbol,
           a.price_source,
           h.quantity::text,
           h.avg_cost::text,
           h.total_invested::text,
           h.current_price::text,
           h.current_value::text,
           h.native_currency,
           h.native_avg_cost::text,
           h.native_total_invested::text,
           h.current_price_native::text,
           h.current_value_native::text
         FROM holding h
         JOIN asset a ON a.id = h.asset_id
         WHERE h.asset_id = $1`,
        [assetId],
      ),
      this.pool.query<LotRow>(
        `SELECT id, transacted_at AS date, type,
                quantity::text, price::text, amount_inr::text, amount::text
         FROM investment_transaction
         WHERE asset_id = $1 AND status = 'confirmed'
         ORDER BY transacted_at DESC`,
        [assetId],
      ),
    ]);

    const h = holdingRes.rows[0];
    if (!h) return null;

    const currentPrice = h.current_price ? new Decimal(h.current_price) : null;
    const currentPriceNative = h.current_price_native ? new Decimal(h.current_price_native) : null;
    const totalInvested = new Decimal(h.total_invested);
    const currentValue = h.current_value ? new Decimal(h.current_value) : null;
    const unrealisedGain = currentValue ? currentValue.sub(totalInvested) : null;
    const absoluteReturnPct =
      unrealisedGain && totalInvested.gt(0) ? unrealisedGain.div(totalInvested).mul(100) : null;

    const today = new Date();

    const lots = lotsRes.rows.map((lot) => {
      const lotValue = currentPrice ? new Decimal(lot.quantity).mul(currentPrice) : null;
      const lotValueNative = currentPriceNative
        ? new Decimal(lot.quantity).mul(currentPriceNative)
        : null;
      let lotXirr: string | null = null;
      if (lot.type === "buy" && lotValue && currentPrice) {
        lotXirr = this.computeXirrFromFlows(
          [{ date: lot.date, amount: -parseFloat(lot.amount_inr) }],
          lotValue,
          today,
        );
      }
      return {
        id: lot.id,
        date: lot.date,
        type: lot.type,
        units: lot.quantity,
        buyPrice: lot.price,
        cost: lot.amount_inr,
        costNative: h.native_currency ? lot.amount : null,
        currentValue: lotValue ? lotValue.toFixed(2) : null,
        currentValueNative: lotValueNative ? lotValueNative.toFixed(2) : null,
        xirr: lotXirr,
      };
    });

    // Asset-level XIRR: all confirmed transactions + terminal value
    const assetFlows: CashFlow[] = lotsRes.rows.map((lot) => ({
      date: lot.date,
      amount: lot.type === "buy" ? -parseFloat(lot.amount_inr) : parseFloat(lot.amount_inr),
    }));
    const assetXirr = currentValue
      ? this.computeXirrFromFlows(assetFlows, currentValue, today)
      : null;

    return {
      assetName: h.asset_name,
      currentValue: currentValue ? currentValue.toFixed(2) : null,
      totalUnits: h.quantity,
      avgCost: h.avg_cost,
      unrealisedGain: unrealisedGain ? unrealisedGain.toFixed(2) : null,
      absoluteReturnPct: absoluteReturnPct ? absoluteReturnPct.toFixed(2) : null,
      xirr: assetXirr,
      nativeCurrency: h.native_currency ?? null,
      nativeAvgCost: h.native_avg_cost ?? null,
      nativeTotalInvested: h.native_total_invested ?? null,
      currentPriceNative: h.current_price_native ?? null,
      currentValueNative: h.current_value_native ?? null,
      lots,
    };
  }

  async refreshHoldingPrices(): Promise<{ updated: number; skipped: number }> {
    await this.computeHolding();

    type AssetRow = { id: number; ticker_symbol: string | null; price_source: string | null };
    const assets = await this.pool.query<AssetRow>(
      `SELECT a.id, a.ticker_symbol, a.price_source::text
       FROM asset a
       JOIN holding h ON h.asset_id = a.id
       WHERE a.price_source IS NOT NULL AND a.price_source != 'manual'`,
    );

    const indianYahooAssets: AssetPriceRow[] = [];
    const usYahooAssets: AssetPriceRow[] = [];
    const otherAssets: AssetPriceRow[] = [];

    for (const a of assets.rows) {
      const row: AssetPriceRow = {
        id: a.id,
        ticker_symbol: a.ticker_symbol,
        price_source: a.price_source as AssetPriceRow["price_source"],
      };
      if (a.price_source === "yahoo_finance") {
        const isIndian = a.ticker_symbol?.endsWith(".NS") || a.ticker_symbol?.endsWith(".BO");
        if (isIndian) {
          indianYahooAssets.push(row);
        } else {
          usYahooAssets.push(row);
        }
      } else {
        otherAssets.push(row);
      }
    }

    const [indianPrices, usPrices] = await Promise.all([
      this.assetPriceService.batchFetchYahooFinancePrices(indianYahooAssets),
      this.assetPriceService.batchFetchFinnhubWithNative(usYahooAssets),
    ]);

    // Non-Yahoo sources (amfi, coinmarketcap, gold_api) fetched sequentially to avoid rate limits
    const otherPrices = new Map<number, Decimal | null>();
    for (let i = 0; i < otherAssets.length; i++) {
      const price = await this.assetPriceService.getPriceInr(otherAssets[i]);
      otherPrices.set(otherAssets[i].id, price);
      if (i < otherAssets.length - 1) await sleep(REFRESH_SLEEP_MS);
    }

    let updated = 0;
    let skipped = 0;

    // Write INR-only prices (Indian stocks + other sources)
    const inrOnlyPrices = new Map<number, Decimal | null>([...indianPrices, ...otherPrices]);
    await Promise.all(
      [...inrOnlyPrices.entries()].map(async ([id, price]) => {
        if (!price) {
          skipped++;
          return;
        }
        await this.pool.query(
          `UPDATE holding SET
             current_price        = $1,
             current_value        = $1::numeric * quantity,
             current_price_native = $1,
             current_value_native = $1::numeric * quantity,
             updated_at           = NOW()
           WHERE asset_id = $2`,
          [price.toFixed(4), id],
        );
        updated++;
      }),
    );

    // Write native + INR prices for US (Finnhub) assets
    await Promise.all(
      [...usPrices.entries()].map(async ([id, result]: [number, FinnhubNativeResult | null]) => {
        if (!result) {
          skipped++;
          return;
        }
        await this.pool.query(
          `UPDATE holding SET
             current_price        = $1,
             current_value        = $1::numeric * quantity,
             current_price_native = $2,
             current_value_native = $2::numeric * quantity,
             native_currency      = 'USD',
             updated_at           = NOW()
           WHERE asset_id = $3`,
          [result.priceInr.toFixed(4), result.priceUsd.toFixed(4), id],
        );
        updated++;
      }),
    );

    return { updated, skipped };
  }

  // ── private helpers ──────────────────────────────────────────────────────

  private async computeHolding(): Promise<void> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM holding");

      const { rows: assets } = await client.query<{ asset_id: number; currency_code: string }>(
        `SELECT DISTINCT it.asset_id, c.code AS currency_code
         FROM investment_transaction it
         JOIN asset    a ON a.id = it.asset_id
         JOIN currency c ON c.id = a.currency_id
         WHERE it.status = 'confirmed'`,
      );

      for (const { asset_id, currency_code } of assets) {
        const { rows: txns } = await client.query<TxnRow>(
          `SELECT type, quantity, amount, amount_inr
           FROM investment_transaction
           WHERE asset_id = $1 AND status = 'confirmed'
           ORDER BY transacted_at ASC, id ASC`,
          [asset_id],
        );

        let runningQty = new Decimal(0);
        let runningCostInr = new Decimal(0);
        let runningCostNative = new Decimal(0);

        for (const txn of txns) {
          const qty = new Decimal(txn.quantity);
          const inr = new Decimal(txn.amount_inr);
          const native = new Decimal(txn.amount);

          if (txn.type === "buy") {
            runningQty = runningQty.plus(qty);
            runningCostInr = runningCostInr.plus(inr);
            runningCostNative = runningCostNative.plus(native);
          } else {
            const fractionRemaining = runningQty.minus(qty).div(runningQty);
            runningCostInr = runningCostInr.mul(fractionRemaining);
            runningCostNative = runningCostNative.mul(fractionRemaining);
            runningQty = runningQty.minus(qty);
            if (runningQty.lte(0)) {
              runningQty = new Decimal(0);
              runningCostInr = new Decimal(0);
              runningCostNative = new Decimal(0);
            }
          }
        }

        if (runningQty.lte(0)) continue;

        await client.query(
          `INSERT INTO holding
             (asset_id, quantity, avg_cost, total_invested,
              native_currency, native_avg_cost, native_total_invested)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            asset_id,
            runningQty.toFixed(8),
            runningCostInr.div(runningQty).toFixed(4),
            runningCostInr.toFixed(4),
            currency_code,
            runningCostNative.div(runningQty).toFixed(4),
            runningCostNative.toFixed(4),
          ],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private async queryPositions(): Promise<PositionRow[]> {
    const result = await this.pool.query<PositionRow>(
      `SELECT
         h.asset_id,
         a.name                   AS asset_name,
         a.ticker_symbol,
         a.price_source::text,
         ic.id                    AS category_id,
         ic.name                  AS category_name,
         (SELECT fi.name
          FROM investment_transaction it
          JOIN financial_institution fi ON fi.id = it.financial_institution_id
          WHERE it.asset_id = h.asset_id AND it.status = 'confirmed'
          LIMIT 1)                AS platform,
         h.quantity::text,
         h.total_invested::text,
         h.current_price::text,
         h.current_value::text
       FROM holding h
       JOIN asset a ON a.id = h.asset_id
       JOIN investment_category ic ON ic.id = a.investment_category_id
       WHERE h.quantity > 0
       ORDER BY ic.name, a.name`,
    );
    return result.rows;
  }

  private async queryTargets(): Promise<AllocationTargetRow[]> {
    const result = await this.pool.query<AllocationTargetRow>(
      `SELECT ic.id AS category_id, ic.name AS category_name,
              pat.target_percentage::text, pat.end_date
       FROM portfolio_allocation_target pat
       JOIN investment_category ic ON ic.id = pat.investment_category_id
       WHERE pat.start_date <= CURRENT_DATE AND pat.end_date >= CURRENT_DATE`,
    );
    return result.rows;
  }

  private async queryPlannedInvestments(): Promise<Decimal> {
    // TODO: currently only sums FUTURE baseline rows (month > today).
    // Revisit when actual month-by-month investment tracking is in place:
    // past months in the target period should use actual invested amounts from
    // investment_transaction, not the baseline estimate. Future months keep using
    // investment_baseline. Combined, this gives a more accurate expected total.
    const result = await this.pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(ib.amount), 0)::text AS total
       FROM investment_baseline ib
       WHERE ib.month > CURRENT_DATE
         AND ib.month <= COALESCE(
           (SELECT MAX(pat.end_date)
            FROM portfolio_allocation_target pat
            WHERE pat.start_date <= CURRENT_DATE AND pat.end_date >= CURRENT_DATE),
           CURRENT_DATE
         )`,
    );
    return new Decimal(result.rows[0].total);
  }

  private groupByAssetClass(
    positions: PositionRow[],
    expectedTotal: Decimal,
    targetMap: Map<number, AllocationTargetRow>,
  ) {
    const map = new Map<number, { categoryName: string; value: Decimal }>();

    for (const p of positions) {
      if (!p.current_value) continue;
      const val = new Decimal(p.current_value);
      const existing = map.get(p.category_id);
      if (existing) {
        existing.value = existing.value.add(val);
      } else {
        map.set(p.category_id, { categoryName: p.category_name, value: val });
      }
    }

    return [...map.entries()].map(([categoryId, { categoryName, value }]) => {
      // percentage and delta are computed against expectedTotal so the bar shows
      // current allocation vs where you need to be at end_date
      const pct = expectedTotal.gt(0) ? value.div(expectedTotal).mul(100) : new Decimal(0);
      const target = targetMap.get(categoryId);
      const targetPct = target ? new Decimal(target.target_percentage) : null;
      const delta = targetPct ? pct.sub(targetPct) : null;
      const targetAbsoluteValue = targetPct ? targetPct.div(100).mul(expectedTotal) : null;

      return {
        categoryId,
        assetClass: categoryName,
        value: value.toFixed(2),
        percentage: pct.toFixed(2),
        targetPercentage: targetPct ? targetPct.toFixed(2) : null,
        targetAbsoluteValue: targetAbsoluteValue ? targetAbsoluteValue.toFixed(2) : null,
        delta: delta ? delta.toFixed(2) : null,
        xirr: null,
      };
    });
  }

  private async queryXirrFlows(): Promise<XirrFlowRow[]> {
    const result = await this.pool.query<XirrFlowRow>(
      `SELECT it.transacted_at, it.type, it.amount_inr::text, ic.id AS category_id
       FROM investment_transaction it
       JOIN asset a ON a.id = it.asset_id
       JOIN investment_category ic ON ic.id = a.investment_category_id
       WHERE it.status = 'confirmed'
       ORDER BY it.transacted_at`,
    );
    return result.rows;
  }

  private computeXirrFromFlows(
    flows: CashFlow[],
    terminalValue: Decimal,
    today: Date,
  ): string | null {
    const allFlows = [...flows, { date: today, amount: terminalValue.toNumber() }];
    const rate = xirr(allFlows);
    return rate !== null ? (rate * 100).toFixed(2) : null;
  }

  private computePortfolioXirr(
    flows: XirrFlowRow[],
    totalValue: Decimal,
    today: Date,
  ): string | null {
    if (totalValue.lte(0)) return null;
    const cashFlows: CashFlow[] = flows.map((f) => ({
      date: f.transacted_at,
      amount: f.type === "buy" ? -parseFloat(f.amount_inr) : parseFloat(f.amount_inr),
    }));
    return this.computeXirrFromFlows(cashFlows, totalValue, today);
  }

  private computeClassXirr(flows: XirrFlowRow[], classValue: Decimal, today: Date): string | null {
    if (classValue.lte(0) || flows.length === 0) return null;
    const cashFlows: CashFlow[] = flows.map((f) => ({
      date: f.transacted_at,
      amount: f.type === "buy" ? -parseFloat(f.amount_inr) : parseFloat(f.amount_inr),
    }));
    return this.computeXirrFromFlows(cashFlows, classValue, today);
  }

  private groupByPlatform(positions: PositionRow[]) {
    const map = new Map<string, { platform: string; assetClass: string; value: Decimal }>();

    for (const p of positions) {
      if (!p.current_value) continue;
      const val = new Decimal(p.current_value);
      const key = `${p.platform}||${p.category_name}`;
      const existing = map.get(key);
      if (existing) {
        existing.value = existing.value.add(val);
      } else {
        map.set(key, { platform: p.platform, assetClass: p.category_name, value: val });
      }
    }

    return [...map.values()].map((e) => ({
      platform: e.platform,
      assetClass: e.assetClass,
      value: e.value.toFixed(2),
    }));
  }
}
