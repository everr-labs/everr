import { describe, expect, it } from "vitest";
import { buildTotalsQuery, decodeTotalsRows } from "./totals";

describe("buildTotalsQuery", () => {
  it("computes totals over a level-uncoupled subquery", () => {
    const built = buildTotalsQuery({
      timeRange: { from: "now-1h", to: "now" },
      levels: ["error"],
      services: [],
      repos: [],
    });
    expect(built.sql).toContain("countIf(level = 'error') AS error");
    expect(built.sql).toContain("countIf(level = 'unknown') AS unknown");
    expect(built.sql).not.toContain("{levels:Array(String)}");
    expect(built.params.levels).toEqual(["error"]);
  });
});

describe("decodeTotalsRows", () => {
  it("returns zero counts when row is missing", () => {
    const result = decodeTotalsRows([], []);
    expect(result.totalCount).toBe(0);
    expect(result.levelCounts.error).toBe(0);
  });

  it("sums only selected levels into totalCount", () => {
    const result = decodeTotalsRows(
      [{ error: "2", warning: "1", info: "5", debug: "0", trace: "0", unknown: "0" }],
      ["error"],
    );
    expect(result.totalCount).toBe(2);
    expect(result.levelCounts.warning).toBe(1);
  });

  it("sums all levels when none are selected", () => {
    const result = decodeTotalsRows(
      [{ error: "1", warning: "1", info: "1", debug: "1", trace: "1", unknown: "1" }],
      [],
    );
    expect(result.totalCount).toBe(6);
  });
});
