import { describe, expect, it } from "vite-plus/test";
import { statColumns } from "./stat-layout";

describe("statColumns", () => {
  it("keeps all tiles on one row when they fit", () => {
    expect(statColumns(3, 369)).toBe(3);
    expect(statColumns(4, 730)).toBe(4);
  });

  it("spreads tiles evenly across the rows they need", () => {
    // 730px fits 7 columns: 10 tiles take 2 rows of 5, not 7 + 3.
    expect(statColumns(10, 730)).toBe(5);
    // 369px fits 3 columns: 10 tiles still need 4 rows of up to 3.
    expect(statColumns(10, 369)).toBe(3);
    // 5 tiles in 4 columns: 3 + 2, not 4 + 1.
    expect(statColumns(5, 400)).toBe(3);
  });

  it("falls back to a single column when the panel is narrower than one tile", () => {
    expect(statColumns(4, 50)).toBe(1);
  });

  it("keeps one row until the panel has been measured", () => {
    expect(statColumns(10, 0)).toBe(10);
  });

  it("uses one column for a single tile", () => {
    expect(statColumns(1, 1000)).toBe(1);
    expect(statColumns(0, 1000)).toBe(1);
  });
});
