import { AssetPriceService, AssetPriceRow } from "./asset-price.service";
import { CurrencyService } from "./currency.service";
import Decimal from "decimal.js";

const mockUsdToInr = new Decimal("84.5");

const makeCurrencyService = (): CurrencyService => {
  const svc = new CurrencyService();
  jest.spyOn(svc, "getUsdToInr").mockResolvedValue(mockUsdToInr);
  return svc;
};

const asset = (
  overrides: Partial<AssetPriceRow> & Pick<AssetPriceRow, "price_source">,
): AssetPriceRow => ({
  id: 1,
  ticker_symbol: "TEST",
  ...overrides,
});

describe("AssetPriceService", () => {
  let service: AssetPriceService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new AssetPriceService(makeCurrencyService());
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("manual / no price_source", () => {
    it("returns null for manual price_source", async () => {
      expect(await service.getPriceInr(asset({ price_source: "manual" }))).toBeNull();
    });

    it("returns null for null price_source", async () => {
      expect(await service.getPriceInr(asset({ price_source: null }))).toBeNull();
    });

    it("returns null when ticker_symbol is null", async () => {
      expect(
        await service.getPriceInr(asset({ price_source: "amfi", ticker_symbol: null })),
      ).toBeNull();
    });
  });

  describe("caching", () => {
    it("returns cached price within 5-minute TTL", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ nav: "170.83" }] }),
      } as unknown as Response);

      const a = asset({ id: 10, price_source: "amfi", ticker_symbol: "118834" });
      await service.getPriceInr(a);
      await service.getPriceInr(a);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("re-fetches after TTL expiry", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ nav: "170.83" }] }),
      } as unknown as Response);

      const a = asset({ id: 10, price_source: "amfi", ticker_symbol: "118834" });
      await service.getPriceInr(a);
      // Manually expire the cache entry
      service["cache"].get(10)!.fetchedAt = new Date(0);
      await service.getPriceInr(a);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("does not cache null result on fetch failure", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ nav: "170.83" }] }),
      } as unknown as Response);

      const a = asset({ id: 10, price_source: "amfi", ticker_symbol: "118834" });
      await service.getPriceInr(a); // fails → null, not cached
      const price = await service.getPriceInr(a); // retries → succeeds

      expect(price?.toNumber()).toBe(170.83);
    });
  });

  describe("amfi (mfapi.in)", () => {
    it("returns NAV as Decimal", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ nav: "170.8290" }] }),
      } as unknown as Response);

      const price = await service.getPriceInr(
        asset({ price_source: "amfi", ticker_symbol: "118834" }),
      );

      expect(price?.toString()).toBe("170.829");
      expect(fetchSpy).toHaveBeenCalledWith("https://api.mfapi.in/mf/118834/latest");
    });

    it("returns null when nav is missing", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      } as unknown as Response);

      const price = await service.getPriceInr(
        asset({ price_source: "amfi", ticker_symbol: "118834" }),
      );
      expect(price).toBeNull();
    });
  });

  describe("coinmarketcap (CoinGecko)", () => {
    it("returns INR price as Decimal", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ bitcoin: { inr: 8500000 } }),
      } as unknown as Response);

      const price = await service.getPriceInr(
        asset({ price_source: "coinmarketcap", ticker_symbol: "bitcoin" }),
      );

      expect(price?.toNumber()).toBe(8500000);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=inr",
      );
    });
  });

  describe("yahoo_finance (Finnhub)", () => {
    beforeEach(() => {
      process.env.FINNHUB_API_KEY = "test-key";
    });

    it("returns INR price directly for .NS tickers", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ c: 811.75 }),
      } as unknown as Response);

      const price = await service.getPriceInr(
        asset({ price_source: "yahoo_finance", ticker_symbol: "HDFCBANK.NS" }),
      );

      expect(price?.toNumber()).toBe(811.75);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://finnhub.io/api/v1/quote?symbol=HDFCBANK.NS&token=test-key",
      );
    });

    it("multiplies by USD/INR for non-.NS tickers", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ c: 200.0 }),
      } as unknown as Response);

      const price = await service.getPriceInr(
        asset({ price_source: "yahoo_finance", ticker_symbol: "MSFT" }),
      );

      // 200 USD × 84.5 INR/USD = 16900
      expect(price?.toNumber()).toBe(16900);
    });

    it("returns null when Finnhub returns price 0", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ c: 0 }),
      } as unknown as Response);

      const price = await service.getPriceInr(
        asset({ price_source: "yahoo_finance", ticker_symbol: "HDFCBANK.NS" }),
      );
      expect(price).toBeNull();
    });
  });

  describe("gold_api (GoldAPI)", () => {
    beforeEach(() => {
      process.env.GOLD_API_KEY = "test-gold-key";
    });

    it("returns price_gram_24k directly as INR Decimal", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ price_gram_24k: 14312.9497 }),
      } as unknown as Response);

      const price = await service.getPriceInr(
        asset({ price_source: "gold_api", ticker_symbol: "XAU" }),
      );

      expect(price?.toNumber()).toBe(14312.9497);
      expect(fetchSpy).toHaveBeenCalledWith("https://www.goldapi.io/api/XAU/INR", {
        headers: { "x-access-token": "test-gold-key", "Content-Type": "application/json" },
      });
    });

    it("returns null when price_gram_24k is missing", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response);

      const price = await service.getPriceInr(
        asset({ price_source: "gold_api", ticker_symbol: "XAU" }),
      );
      expect(price).toBeNull();
    });
  });

  describe("error handling", () => {
    it("returns null on HTTP error", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 429,
      } as unknown as Response);

      const price = await service.getPriceInr(
        asset({ price_source: "amfi", ticker_symbol: "118834" }),
      );
      expect(price).toBeNull();
    });

    it("returns null on network error", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const price = await service.getPriceInr(
        asset({ price_source: "amfi", ticker_symbol: "118834" }),
      );
      expect(price).toBeNull();
    });
  });
});
