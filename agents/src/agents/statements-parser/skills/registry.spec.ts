import { getSkill, getSupportedPlatforms } from "./registry";

describe("getSkill", () => {
  it("throws for unknown platform with supported list in message", () => {
    expect(() => getSkill("groww")).toThrow('No skill registered for platform "groww". Supported:');
  });

  it("supported list message contains known platform ids", () => {
    try {
      getSkill("unknown-platform");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("zerodha");
      expect(msg).toContain("hdfc-bank");
    }
  });
});

describe("getSupportedPlatforms", () => {
  it("returns a non-empty array", () => {
    expect(getSupportedPlatforms().length).toBeGreaterThan(0);
  });

  it("includes all 6 required platforms", () => {
    const platforms = getSupportedPlatforms();
    ["zerodha", "indmoney", "coinswitch", "paytm-money", "employer-stock", "hdfc-bank"].forEach(
      (p) => {
        expect(platforms).toContain(p);
      },
    );
  });
});
