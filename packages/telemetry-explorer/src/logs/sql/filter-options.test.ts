import { describe, expect, it } from "vite-plus/test";
import { buildFilterOptionsQuery, decodeFilterOptionsRows } from "./filter-options";

describe("buildFilterOptionsQuery", () => {
  it("queries distinct services within range", () => {
    const built = buildFilterOptionsQuery({
      timeRange: { from: "2026-06-10T00:00:00.000Z", to: "2026-06-10T01:00:00.000Z" },
    });
    expect(built.sql).toContain("DISTINCT ServiceName");
    expect(typeof built.params.fromTime).toBe("string");
  });
});

describe("decodeFilterOptionsRows", () => {
  it("returns empty arrays when no row", () => {
    expect(decodeFilterOptionsRows([])).toEqual({ services: [] });
  });
});
