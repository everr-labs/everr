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
});
