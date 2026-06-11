import { describe, expect, it } from "vitest";
import { regionToNumericId } from "./country-codes";

describe("regionToNumericId", () => {
  it("resolves alpha-2 codes", () => {
    expect(regionToNumericId("US")).toBe("840");
    expect(regionToNumericId("DE")).toBe("276");
  });

  it("resolves alpha-3 codes", () => {
    expect(regionToNumericId("USA")).toBe("840");
    expect(regionToNumericId("DEU")).toBe("276");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(regionToNumericId("  us ")).toBe("840");
    expect(regionToNumericId("usa")).toBe("840");
  });

  it("returns undefined for unknown codes", () => {
    expect(regionToNumericId("ZZ")).toBeUndefined();
    expect(regionToNumericId("")).toBeUndefined();
  });

  it("resolves spot-check codes", () => {
    expect(regionToNumericId("us")).toBe("840");
    expect(regionToNumericId("DEU")).toBe("276");
    expect(regionToNumericId("GB")).toBe("826");
    expect(regionToNumericId("GBR")).toBe("826");
  });

  it("covers the full alpha-2 country set", () => {
    let alpha2Count = 0;
    for (let cc = 0; cc < 26 * 26; cc++) {
      const code =
        String.fromCharCode(65 + Math.floor(cc / 26)) +
        String.fromCharCode(65 + (cc % 26));
      if (regionToNumericId(code)) alpha2Count++;
    }
    expect(alpha2Count).toBeGreaterThanOrEqual(240);
  });
});
