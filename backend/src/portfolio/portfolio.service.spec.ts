import { PortfolioService } from "./portfolio.service";
import { AssetPriceService } from "../asset-price/asset-price.service";
import Decimal from "decimal.js";

// Minimal mock pool — feed query results in call order
const makeMockPool = (...results: { rows: unknown[] }[]) => {
  const query = jest.fn();
  results.forEach((r) => query.mockResolvedValueOnce(r));
  return { query };
};

const mockAssetPriceService = () =>
  ({
    getPriceInr: jest.fn().mockResolvedValue(null),
    batchFetchYahooFinancePrices: jest.fn().mockResolvedValue(new Map()),
    batchFetchFinnhubWithNative: jest.fn().mockResolvedValue(new Map()),
  }) as unknown as AssetPriceService;

// Shared position row factory — auto-computes current_value from quantity × current_price
const pos = (
  overrides: Partial<{
    asset_id: number;
    asset_name: string;
    ticker_symbol: string;
    price_source: string;
    category_id: number;
    category_name: string;
    platform: string;
    quantity: string;
    total_invested: string;
    current_price: string | null;
    current_value: string | null;
  }>,
) => {
  const merged = {
    asset_id: 1,
    asset_name: "Test Asset",
    ticker_symbol: "TEST.NS",
    price_source: "yahoo_finance",
    category_id: 2,
    category_name: "Indian Equity",
    platform: "Zerodha",
    quantity: "100",
    total_invested: "1000",
    current_price: null as string | null,
    current_value: null as string | null,
    ...overrides,
  };
  if (merged.current_value === null && merged.current_price !== null) {
    merged.current_value = (parseFloat(merged.quantity) * parseFloat(merged.current_price)).toFixed(
      4,
    );
  }
  return merged;
};

// getSummary uses Promise.all([queryPositions, queryTargets, queryXirrFlows]) — 3 pool results
const noFlows = { rows: [] }; // empty XIRR flows → overallXirr = null

describe("PortfolioService", () => {
  describe("getSummary", () => {
    it("returns totalValue as sum of all current values", async () => {
      const pool = makeMockPool(
        {
          rows: [
            pos({ asset_id: 1, quantity: "100", current_price: "10" }),
            pos({
              asset_id: 2,
              category_name: "Indian Mutual Fund",
              category_id: 4,
              platform: "PayTM Money",
              quantity: "50",
              ticker_symbol: "118834",
              price_source: "amfi",
              current_price: "20",
            }),
          ],
        },
        { rows: [] }, // targets
        noFlows,
      );

      const svc = new PortfolioService(pool as never, mockAssetPriceService());
      const result = await svc.getSummary();

      // asset1: 100 × 10 = 1000, asset2: 50 × 20 = 1000 → total = 2000
      expect(result.totalValue).toBe("2000.00");
    });

    it("excludes assets with null current_price from total", async () => {
      const pool = makeMockPool(
        {
          rows: [
            pos({ asset_id: 1, quantity: "100", current_price: "10" }),
            pos({
              asset_id: 55,
              price_source: "manual",
              category_name: "EPF",
              category_id: 3,
              quantity: "1720000",
              current_price: null,
            }),
          ],
        },
        { rows: [] },
        noFlows,
      );

      const svc = new PortfolioService(pool as never, mockAssetPriceService());
      const result = await svc.getSummary();

      expect(result.totalValue).toBe("1000.00");
    });

    it("includes manual assets when current_price is set in holding", async () => {
      const pool = makeMockPool(
        {
          rows: [
            pos({ asset_id: 1, quantity: "100", current_price: "10" }),
            pos({
              asset_id: 55,
              price_source: "manual",
              category_name: "EPF",
              category_id: 3,
              quantity: "1720000",
              current_price: "1",
            }),
          ],
        },
        { rows: [] },
        noFlows,
      );

      const svc = new PortfolioService(pool as never, mockAssetPriceService());
      const result = await svc.getSummary();

      // 1000 + 1720000 × 1 = 1721000
      expect(result.totalValue).toBe("1721000.00");
    });

    it("computes byAssetClass with correct percentage, target, and null xirr when no flows", async () => {
      const pool = makeMockPool(
        {
          rows: [
            pos({
              asset_id: 1,
              category_id: 2,
              category_name: "Indian Equity",
              quantity: "100",
              current_price: "10",
            }),
            pos({
              asset_id: 2,
              category_id: 4,
              category_name: "Indian Mutual Fund",
              quantity: "50",
              ticker_symbol: "118834",
              price_source: "amfi",
              current_price: "20",
            }),
          ],
        },
        {
          rows: [
            { category_id: 2, category_name: "Indian Equity", target_percentage: "50.00" },
            { category_id: 4, category_name: "Indian Mutual Fund", target_percentage: "50.00" },
          ],
        },
        noFlows,
      );

      const svc = new PortfolioService(pool as never, mockAssetPriceService());
      const result = await svc.getSummary();

      const equity = result.byAssetClass.find((c) => c.assetClass === "Indian Equity")!;
      expect(equity.value).toBe("1000.00");
      expect(equity.percentage).toBe("50.00");
      expect(equity.targetPercentage).toBe("50.00");
      expect(equity.delta).toBe("0.00");
      expect(equity.xirr).toBeNull();
    });

    it("generates overweight suggestion when actual > target + 3", async () => {
      const pool = makeMockPool(
        {
          rows: [
            pos({
              asset_id: 1,
              category_id: 2,
              category_name: "Indian Equity",
              quantity: "800",
              current_price: "10",
            }),
            pos({
              asset_id: 2,
              category_id: 4,
              category_name: "Indian Mutual Fund",
              quantity: "200",
              ticker_symbol: "118834",
              price_source: "amfi",
              current_price: "10",
            }),
          ],
        },
        {
          rows: [
            { category_id: 2, category_name: "Indian Equity", target_percentage: "50.00" },
            { category_id: 4, category_name: "Indian Mutual Fund", target_percentage: "50.00" },
          ],
        },
        noFlows,
      );

      const svc = new PortfolioService(pool as never, mockAssetPriceService());
      const result = await svc.getSummary();

      // Indian Equity: 8000/10000 = 80% actual vs 50% target → delta = +30 → overweight
      const suggestion = result.rebalancingSuggestions.find(
        (s) => s.assetClass === "Indian Equity",
      )!;
      expect(suggestion.tag).toBe("overweight");
      expect(suggestion.actualPct).toBe("80.00");
      expect(suggestion.targetPct).toBe("50.00");
    });

    it("generates underweight suggestion when actual < target - 3", async () => {
      const pool = makeMockPool(
        {
          rows: [
            pos({
              asset_id: 1,
              category_id: 2,
              category_name: "Indian Equity",
              quantity: "200",
              current_price: "10",
            }),
            pos({
              asset_id: 2,
              category_id: 4,
              category_name: "Indian Mutual Fund",
              quantity: "800",
              ticker_symbol: "118834",
              price_source: "amfi",
              current_price: "10",
            }),
          ],
        },
        {
          rows: [
            { category_id: 2, category_name: "Indian Equity", target_percentage: "50.00" },
            { category_id: 4, category_name: "Indian Mutual Fund", target_percentage: "50.00" },
          ],
        },
        noFlows,
      );

      const svc = new PortfolioService(pool as never, mockAssetPriceService());
      const result = await svc.getSummary();

      const suggestion = result.rebalancingSuggestions.find(
        (s) => s.assetClass === "Indian Equity",
      )!;
      expect(suggestion.tag).toBe("underweight");
    });

    it("does not suggest for delta within ±3%", async () => {
      const pool = makeMockPool(
        {
          rows: [
            pos({
              asset_id: 1,
              category_id: 2,
              category_name: "Indian Equity",
              quantity: "100",
              current_price: "10",
            }),
          ],
        },
        { rows: [{ category_id: 2, category_name: "Indian Equity", target_percentage: "100.00" }] },
        noFlows,
      );

      const svc = new PortfolioService(pool as never, mockAssetPriceService());
      const result = await svc.getSummary();

      expect(result.rebalancingSuggestions).toHaveLength(0);
    });

    it("groups byPlatform by (platform, assetClass)", async () => {
      const pool = makeMockPool(
        {
          rows: [
            pos({
              asset_id: 1,
              category_id: 2,
              category_name: "Indian Equity",
              platform: "Zerodha",
              quantity: "100",
              current_price: "10",
            }),
            pos({
              asset_id: 2,
              category_id: 4,
              category_name: "Indian Mutual Fund",
              platform: "PayTM Money",
              quantity: "50",
              ticker_symbol: "118834",
              price_source: "amfi",
              current_price: "20",
            }),
          ],
        },
        { rows: [] },
        noFlows,
      );

      const svc = new PortfolioService(pool as never, mockAssetPriceService());
      const result = await svc.getSummary();

      const zerodha = result.byPlatform.find((p) => p.platform === "Zerodha")!;
      const paytm = result.byPlatform.find((p) => p.platform === "PayTM Money")!;
      expect(zerodha.value).toBe("1000.00");
      expect(zerodha.assetClass).toBe("Indian Equity");
      expect(paytm.value).toBe("1000.00");
    });

    it("computes non-null overallXirr and byAssetClass.xirr when cash flows exist", async () => {
      const pool = makeMockPool(
        {
          rows: [
            pos({
              asset_id: 1,
              category_id: 2,
              category_name: "Indian Equity",
              quantity: "100",
              current_price: "11",
            }),
          ],
        },
        { rows: [] },
        {
          // One buy of ₹1000, one year ago — matches 10% annual return vs current value ₹1100
          rows: [
            {
              transacted_at: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
              type: "buy",
              amount_inr: "1000",
              category_id: 2,
            },
          ],
        },
      );

      const svc = new PortfolioService(pool as never, mockAssetPriceService());
      const result = await svc.getSummary();

      expect(result.overallXirr).not.toBeNull();
      const equity = result.byAssetClass.find((c) => c.assetClass === "Indian Equity")!;
      expect(equity.xirr).not.toBeNull();
    });
  });

  describe("getAssets", () => {
    it("returns asset list with id, name, assetClass, platform", async () => {
      const pool = makeMockPool({
        rows: [{ id: 1, name: "HDFC Bank", asset_class: "Indian Equity", platform: "Zerodha" }],
      });

      const svc = new PortfolioService(pool as never, mockAssetPriceService());
      const result = await svc.getAssets();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        name: "HDFC Bank",
        assetClass: "Indian Equity",
        platform: "Zerodha",
      });
    });
  });

  describe("getAssetDetail", () => {
    it("computes xirr and lot xirr from holding + lots data", async () => {
      const pool = makeMockPool(
        {
          rows: [
            {
              asset_id: 10,
              asset_name: "HDFC Bank",
              ticker_symbol: "HDFCBANK.NS",
              price_source: "yahoo_finance",
              quantity: "91",
              avg_cost: "810.0000",
              total_invested: "73710.0000",
              current_price: "820",
              current_value: "74620.0000",
            },
          ],
        },
        {
          rows: [
            {
              id: 1,
              date: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // ~1 year ago
              type: "buy",
              quantity: "91.00000000",
              price: "810.0000",
              amount_inr: "73710.0000",
            },
          ],
        },
      );

      const svc = new PortfolioService(pool as never, mockAssetPriceService());
      const result = await svc.getAssetDetail(10);

      expect(result).not.toBeNull();
      expect(result!.currentValue).toBe("74620.00");
      expect(result!.unrealisedGain).toBe("910.00");
      expect(result!.xirr).not.toBeNull();
      expect(result!.lots[0].xirr).not.toBeNull();
    });

    it("returns null xirr when current_price is null", async () => {
      const pool = makeMockPool(
        {
          rows: [
            {
              asset_id: 10,
              asset_name: "Manual Asset",
              ticker_symbol: null,
              price_source: "manual",
              quantity: "1",
              avg_cost: "100.0000",
              total_invested: "100.0000",
              current_price: null,
              current_value: null,
            },
          ],
        },
        { rows: [] },
      );

      const svc = new PortfolioService(pool as never, mockAssetPriceService());
      const result = await svc.getAssetDetail(10);

      expect(result!.currentValue).toBeNull();
      expect(result!.xirr).toBeNull();
    });

    it("returns metrics and lots with correct cost from amount_inr", async () => {
      const pool = makeMockPool(
        {
          rows: [
            {
              asset_id: 10,
              asset_name: "HDFC Bank",
              ticker_symbol: "HDFCBANK.NS",
              price_source: "yahoo_finance",
              quantity: "91",
              avg_cost: "810.0000",
              total_invested: "73710.0000",
              current_price: "820",
              current_value: "74620.0000",
              native_currency: null,
              native_avg_cost: null,
              native_total_invested: null,
              current_price_native: null,
              current_value_native: null,
            },
          ],
        },
        {
          rows: [
            {
              id: 1,
              date: new Date("2026-04-01"),
              type: "buy",
              quantity: "91.00000000",
              price: "810.0000",
              amount_inr: "73710.0000",
              amount: "73710.0000",
            },
          ],
        },
      );

      const svc = new PortfolioService(pool as never, mockAssetPriceService());
      const result = await svc.getAssetDetail(10);

      expect(result!.lots[0].cost).toBe("73710.0000");
      expect(result!.lots[0].type).toBe("buy");
    });

    it("returns native fields for a USD holding", async () => {
      const pool = makeMockPool(
        {
          rows: [
            {
              asset_id: 20,
              asset_name: "Apple Inc",
              ticker_symbol: "AAPL",
              price_source: "yahoo_finance",
              quantity: "10",
              avg_cost: "16000.0000",
              total_invested: "160000.0000",
              current_price: "17000",
              current_value: "170000.0000",
              native_currency: "USD",
              native_avg_cost: "190.0000",
              native_total_invested: "1900.0000",
              current_price_native: "195.0000",
              current_value_native: "1950.0000",
            },
          ],
        },
        {
          rows: [
            {
              id: 2,
              date: new Date("2026-01-01"),
              type: "buy",
              quantity: "10.00000000",
              price: "190.0000",
              amount_inr: "160000.0000",
              amount: "1900.0000",
            },
          ],
        },
      );

      const svc = new PortfolioService(pool as never, mockAssetPriceService());
      const result = await svc.getAssetDetail(20);

      expect(result!.nativeCurrency).toBe("USD");
      expect(result!.nativeAvgCost).toBe("190.0000");
      expect(result!.nativeTotalInvested).toBe("1900.0000");
      expect(result!.currentPriceNative).toBe("195.0000");
      expect(result!.currentValueNative).toBe("1950.0000");
      expect(result!.lots[0].costNative).toBe("1900.0000");
      expect(result!.lots[0].currentValueNative).not.toBeNull();
    });

    it("returns null native fields for an INR holding", async () => {
      const pool = makeMockPool(
        {
          rows: [
            {
              asset_id: 10,
              asset_name: "HDFC Bank",
              ticker_symbol: "HDFCBANK.NS",
              price_source: "yahoo_finance",
              quantity: "91",
              avg_cost: "810.0000",
              total_invested: "73710.0000",
              current_price: "820",
              current_value: "74620.0000",
              native_currency: null,
              native_avg_cost: null,
              native_total_invested: null,
              current_price_native: null,
              current_value_native: null,
            },
          ],
        },
        {
          rows: [
            {
              id: 1,
              date: new Date("2026-04-01"),
              type: "buy",
              quantity: "91.00000000",
              price: "810.0000",
              amount_inr: "73710.0000",
              amount: "73710.0000",
            },
          ],
        },
      );

      const svc = new PortfolioService(pool as never, mockAssetPriceService());
      const result = await svc.getAssetDetail(10);

      expect(result!.nativeCurrency).toBeNull();
      expect(result!.nativeAvgCost).toBeNull();
      expect(result!.lots[0].costNative).toBeNull();
      expect(result!.lots[0].currentValueNative).toBeNull();
    });
  });

  describe("refreshHoldingPrices", () => {
    it("writes current_price_native and current_value_native for Finnhub (US) assets", async () => {
      const priceUsd = new Decimal("195");
      const priceInr = new Decimal("17940");

      const assetQueryResult = {
        rows: [{ id: 7, ticker_symbol: "AAPL", price_source: "yahoo_finance" }],
      };
      const pool = makeMockPool(assetQueryResult, { rows: [] }); // second query = UPDATE result

      const priceSvc = mockAssetPriceService();
      jest
        .spyOn(priceSvc, "batchFetchFinnhubWithNative")
        .mockResolvedValue(new Map([[7, { priceUsd, priceInr }]]));

      const svc = new PortfolioService(pool as never, priceSvc);
      await svc.refreshHoldingPrices();

      const calls = pool.query.mock.calls as [string, unknown[]][];
      const updateCall = calls[1];
      expect(updateCall[0]).toContain("current_price_native");
      expect(updateCall[0]).toContain("current_value_native");
      expect(updateCall[1]).toContain("195.0000"); // priceUsd
    });
  });
});
