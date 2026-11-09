import { describe, expect, it } from "vite-plus/test";
import { buildBarChartModel } from "./bar-chart-data";

const X_KEY = "__x";

describe("buildBarChartModel", () => {
  it("puts bars over time in time order across queries, skipping unparseable times", () => {
    const model = buildBarChartModel([
      [
        { time: "2026-06-07T00:01:00", a: 2 },
        { time: "garbage", a: 99 },
      ],
      [{ time: "2026-06-07T00:00:00", b: 1 }],
    ]);
    expect(model.isTimeAxis).toBe(true);
    expect(model.chartData.map((r) => r[X_KEY])).toEqual([
      Date.parse("2026-06-07T00:00:00Z"),
      Date.parse("2026-06-07T00:01:00Z"),
    ]);
  });

  it("falls back to the first string column as categories, in first-seen order", () => {
    const model = buildBarChartModel([
      [
        { endpoint: "/users", requests: "10" },
        { endpoint: "/orders", requests: 7 },
      ],
    ]);
    expect(model.isTimeAxis).toBe(false);
    expect(model.chartData.map((r) => r[X_KEY])).toEqual(["/users", "/orders"]);
    // ClickHouse quotes 64-bit aggregates.
    expect(model.chartData.map((r) => r.s0)).toEqual([10, 7]);
  });

  it("pivots a string column into one series per label on a time axis", () => {
    const model = buildBarChartModel([
      [
        { ts: "2026-06-07T00:00:00", status: "ok", count: 8 },
        { ts: "2026-06-07T00:00:00", status: "error", count: 2 },
        { ts: "2026-06-07T00:01:00", status: "ok", count: 9 },
      ],
    ]);
    // Pivoted series keep the order the rows arrived in, so a query's
    // ORDER BY decides which series stacks at the bottom.
    expect(model.series.map((s) => s.label)).toEqual(["ok", "error"]);
    expect(model.chartData.map((r) => [r.s0, r.s1])).toEqual([
      [8, 2],
      // "no bar here" stays absent, not 0.
      [9, undefined],
    ]);
    // Identities, unlike render keys, follow the series when rows reorder.
    const reordered = buildBarChartModel([
      [
        { ts: "2026-06-07T00:00:00", status: "error", count: 2 },
        { ts: "2026-06-07T00:00:00", status: "ok", count: 8 },
      ],
    ]);
    const identityOf = (m: typeof model, label: string) =>
      m.series.find((s) => s.label === label)?.identity;
    expect(identityOf(reordered, "ok")).toBe(identityOf(model, "ok"));
  });

  it("pivots remaining string columns on a category axis", () => {
    const model = buildBarChartModel([
      [
        { endpoint: "/users", method: "GET", requests: 10 },
        { endpoint: "/users", method: "POST", requests: 3 },
        { endpoint: "/orders", method: "GET", requests: 7 },
      ],
    ]);
    expect(model.series.map((s) => s.label)).toEqual(["GET", "POST"]);
    expect(model.chartData.map((r) => [r[X_KEY], r.s0, r.s1])).toEqual([
      ["/users", 10, 3],
      ["/orders", 7, undefined],
    ]);
  });

  it("merges queries sharing categories, each series in its own color", () => {
    const model = buildBarChartModel([
      [{ service: "api", errors: 4 }],
      [{ service: "api", warnings: 9 }],
    ]);
    expect(model.chartData.map((r) => [r.s0, r.s1])).toEqual([[4, 9]]);
    expect(model.series[0]?.color).not.toBe(model.series[1]?.color);
  });
});
