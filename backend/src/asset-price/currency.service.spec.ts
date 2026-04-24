import { CurrencyService } from "./currency.service";

describe("CurrencyService", () => {
  let service: CurrencyService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new CurrencyService();
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("fetches USD/INR rate from Frankfurter", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ rates: { INR: 84.5 } }),
    } as unknown as Response);

    const rate = await service.getUsdToInr();

    expect(rate.toNumber()).toBe(84.5);
    expect(fetchSpy).toHaveBeenCalledWith("https://api.frankfurter.app/latest?from=USD&to=INR");
  });

  it("returns cached rate within 1 hour", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ rates: { INR: 84.5 } }),
    } as unknown as Response);

    await service.getUsdToInr();
    await service.getUsdToInr();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns fallback 85 when fetch fails and no cache", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network error"));

    const rate = await service.getUsdToInr();

    expect(rate.toNumber()).toBe(85);
  });

  it("returns stale cache when fetch fails", async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ rates: { INR: 83.0 } }),
      } as unknown as Response)
      .mockRejectedValueOnce(new Error("network error"));

    await service.getUsdToInr();
    service["cached"]!.fetchedAt = new Date(0); // expire the cache
    const rate = await service.getUsdToInr();

    expect(rate.toNumber()).toBe(83.0);
  });
});
