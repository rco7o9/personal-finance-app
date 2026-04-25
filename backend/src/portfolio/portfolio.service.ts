import { Injectable, Inject } from "@nestjs/common";
import { Pool } from "pg";
import Decimal from "decimal.js";
import { AssetPriceService, AssetPriceRow } from "../asset-price/asset-price.service";
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
};

type AllocationTargetRow = {
  category_id: number;
  category_name: string;
  target_percentage: string;
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
};

type LotRow = {
  id: number;
  date: Date;
  type: string;
  quantity: string;
  price: string;
  amount_inr: string;
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
    const [positions, targets, flows] = await Promise.all([
      this.queryPositions(),
      this.queryTargets(),
      this.queryXirrFlows(),
    ]);

    const targetMap = new Map(targets.map((t) => [t.category_id, t]));

    const positionsWithValue = positions.map((p) => ({
      ...p,
      currentValue: this.computeCurrentValue(p),
    }));

    const totalValue = positionsWithValue.reduce(
      (sum, p) => (p.currentValue ? sum.add(p.currentValue) : sum),
      new Decimal(0),
    );

    const byAssetClass = this.groupByAssetClass(positionsWithValue, totalValue, targetMap);
    const byPlatform = this.groupByPlatform(positionsWithValue);

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
        return {
          tag: delta.gt(0) ? "overweight" : "underweight",
          assetClass: c.assetClass,
          actualPct: c.percentage,
          targetPct: c.targetPercentage!,
          message: `${c.assetClass} is ${delta.abs().toFixed(2)}% ${delta.gt(0) ? "above" : "below"} target`,
        };
      });

    return {
      totalValue: totalValue.toFixed(2),
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
           h.current_price::text
         FROM holding h
         JOIN asset a ON a.id = h.asset_id
         WHERE h.asset_id = $1`,
        [assetId],
      ),
      this.pool.query<LotRow>(
        `SELECT id, transacted_at AS date, type,
                quantity::text, price::text, amount_inr::text
         FROM investment_transaction
         WHERE asset_id = $1 AND status = 'confirmed'
         ORDER BY transacted_at DESC`,
        [assetId],
      ),
    ]);

    const h = holdingRes.rows[0];
    if (!h) return null;

    const currentPrice = h.current_price ? new Decimal(h.current_price) : null;
    const qty = new Decimal(h.quantity);
    const totalInvested = new Decimal(h.total_invested);
    const currentValue = currentPrice ? qty.mul(currentPrice) : null;
    const unrealisedGain = currentValue ? currentValue.sub(totalInvested) : null;
    const absoluteReturnPct =
      unrealisedGain && totalInvested.gt(0) ? unrealisedGain.div(totalInvested).mul(100) : null;

    const today = new Date();

    const lots = lotsRes.rows.map((lot) => {
      const lotValue = currentPrice ? new Decimal(lot.quantity).mul(currentPrice) : null;
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
        currentValue: lotValue ? lotValue.toFixed(2) : null,
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
      lots,
    };
  }

  async refreshHoldingPrices(): Promise<{ updated: number; skipped: number }> {
    type AssetRow = { id: number; ticker_symbol: string | null; price_source: string | null };
    const assets = await this.pool.query<AssetRow>(
      `SELECT id, ticker_symbol, price_source::text FROM asset
       WHERE price_source IS NOT NULL AND price_source != 'manual'`,
    );

    const yahooAssets: AssetPriceRow[] = [];
    const otherAssets: AssetPriceRow[] = [];

    for (const a of assets.rows) {
      const row: AssetPriceRow = {
        id: a.id,
        ticker_symbol: a.ticker_symbol,
        price_source: a.price_source as AssetPriceRow["price_source"],
      };
      if (a.price_source === "yahoo_finance") {
        yahooAssets.push(row);
      } else {
        otherAssets.push(row);
      }
    }

    const yahooPrices = await this.assetPriceService.batchFetchYahooFinancePrices(yahooAssets);

    // Non-Yahoo sources (amfi, coinmarketcap, gold_api) fetched sequentially to avoid rate limits
    const otherPrices = new Map<number, Decimal | null>();
    for (let i = 0; i < otherAssets.length; i++) {
      const price = await this.assetPriceService.getPriceInr(otherAssets[i]);
      otherPrices.set(otherAssets[i].id, price);
      if (i < otherAssets.length - 1) await sleep(REFRESH_SLEEP_MS);
    }

    const allPrices = new Map([...yahooPrices, ...otherPrices]);

    let updated = 0;
    let skipped = 0;

    await Promise.all(
      assets.rows.map(async (a) => {
        const price = allPrices.get(a.id);
        if (!price) {
          skipped++;
          return;
        }
        await this.pool.query(`UPDATE holding SET current_price = $1 WHERE asset_id = $2`, [
          price.toFixed(4),
          a.id,
        ]);
        updated++;
      }),
    );

    return { updated, skipped };
  }

  // ── private helpers ──────────────────────────────────────────────────────

  private async queryPositions(): Promise<PositionRow[]> {
    const result = await this.pool.query<PositionRow>(
      `SELECT
         a.id                                                                              AS asset_id,
         a.name                                                                            AS asset_name,
         a.ticker_symbol,
         a.price_source::text,
         ic.id                                                                             AS category_id,
         ic.name                                                                           AS category_name,
         fi.name                                                                           AS platform,
         SUM(CASE WHEN it.type = 'buy' THEN it.quantity    ELSE -it.quantity    END)::text AS quantity,
         SUM(CASE WHEN it.type = 'buy' THEN it.amount_inr  ELSE -it.amount_inr  END)::text AS total_invested,
         h.current_price::text
       FROM investment_transaction it
       JOIN asset a ON a.id = it.asset_id
       JOIN investment_category ic ON ic.id = a.investment_category_id
       JOIN financial_institution fi ON fi.id = it.financial_institution_id
       LEFT JOIN holding h ON h.asset_id = a.id
       WHERE it.status = 'confirmed'
       GROUP BY a.id, a.name, a.ticker_symbol, a.price_source,
                ic.id, ic.name, fi.name, h.current_price
       HAVING SUM(CASE WHEN it.type = 'buy' THEN it.quantity ELSE -it.quantity END) > 0
       ORDER BY ic.name, a.name`,
    );
    return result.rows;
  }

  private async queryTargets(): Promise<AllocationTargetRow[]> {
    const result = await this.pool.query<AllocationTargetRow>(
      `SELECT ic.id AS category_id, ic.name AS category_name,
              pat.target_percentage::text
       FROM portfolio_allocation_target pat
       JOIN investment_category ic ON ic.id = pat.investment_category_id
       WHERE pat.start_date <= CURRENT_DATE AND pat.end_date >= CURRENT_DATE`,
    );
    return result.rows;
  }

  private computeCurrentValue(p: PositionRow): Decimal | null {
    if (!p.current_price) return null;
    return new Decimal(p.quantity).mul(new Decimal(p.current_price));
  }

  private groupByAssetClass(
    positions: (PositionRow & { currentValue: Decimal | null })[],
    totalValue: Decimal,
    targetMap: Map<number, AllocationTargetRow>,
  ) {
    const map = new Map<number, { categoryName: string; value: Decimal }>();

    for (const p of positions) {
      if (!p.currentValue) continue;
      const existing = map.get(p.category_id);
      if (existing) {
        existing.value = existing.value.add(p.currentValue);
      } else {
        map.set(p.category_id, {
          categoryName: p.category_name,
          value: p.currentValue,
        });
      }
    }

    return [...map.entries()].map(([categoryId, { categoryName, value }]) => {
      const pct = totalValue.gt(0) ? value.div(totalValue).mul(100) : new Decimal(0);
      const target = targetMap.get(categoryId);
      const targetPct = target ? new Decimal(target.target_percentage) : null;
      const delta = targetPct ? pct.sub(targetPct) : null;

      return {
        categoryId,
        assetClass: categoryName,
        value: value.toFixed(2),
        percentage: pct.toFixed(2),
        targetPercentage: targetPct ? targetPct.toFixed(2) : null,
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

  private groupByPlatform(positions: (PositionRow & { currentValue: Decimal | null })[]) {
    const map = new Map<string, { platform: string; assetClass: string; value: Decimal }>();

    for (const p of positions) {
      if (!p.currentValue) continue;
      const key = `${p.platform}||${p.category_name}`;
      const existing = map.get(key);
      if (existing) {
        existing.value = existing.value.add(p.currentValue);
      } else {
        map.set(key, {
          platform: p.platform,
          assetClass: p.category_name,
          value: p.currentValue,
        });
      }
    }

    return [...map.values()].map((e) => ({
      platform: e.platform,
      assetClass: e.assetClass,
      value: e.value.toFixed(2),
    }));
  }
}
