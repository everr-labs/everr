import { describe, expect, it } from "vitest";
import { buildBarChartModel } from "./bar-chart-data";

const X_KEY = "__x";

describe("buildBarChartModel", () => {
  it("uses the time column as the x-axis and assigns opaque render keys", () => {
    const model = buildBarChartModel([
      [{ time: "2026-06-07T00:00:00", value: 5 }],
    ]);
    expect(model.isTimeAxis).toBe(true);
    expect(model.valueKeys).toEqual(["s0"]);
    expect(model.chartConfig.s0?.label).toBe("value");
    expect(model.chartData[0]?.[X_KEY]).toBeTypeOf("number");
    expect(model.chartData[0]?.s0).toBe(5);
  });

  it("falls back to the first string column as a category axis", () => {
    const model = buildBarChartModel([
      [
        { endpoint: "/users", requests: 10 },
        { endpoint: "/orders", requests: 7 },
      ],
    ]);
    expect(model.isTimeAxis).toBe(false);
    expect(model.chartData.map((r) => r[X_KEY])).toEqual(["/users", "/orders"]);
    expect(model.chartData.map((r) => r.s0)).toEqual([10, 7]);
  });

  it("keeps category order as first seen instead of sorting", () => {
    const model = buildBarChartModel([
      [
        { region: "zeta", value: 1 },
        { region: "alpha", value: 2 },
      ],
    ]);
    expect(model.chartData.map((r) => r[X_KEY])).toEqual(["zeta", "alpha"]);
  });

  it("sorts a time axis ascending across queries", () => {
    const model = buildBarChartModel([
      [{ time: "2026-06-07T00:01:00", a: 2 }],
      [{ time: "2026-06-07T00:00:00", b: 1 }],
    ]);
    const xs = model.chartData.map((r) => r[X_KEY] as number);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(model.chartData).toHaveLength(2);
  });

  it("skips rows whose timestamp cannot be parsed", () => {
    const model = buildBarChartModel([
      [
        { time: "garbage", value: 99 },
        { time: "2026-06-07T00:00:00", value: 5 },
      ],
    ]);
    expect(model.chartData).toHaveLength(1);
    expect(model.chartData[0]?.s0).toBe(5);
  });

  it("pivots a string column into one series per label on a time axis", () => {
    const model = buildBarChartModel([
      [
        { ts: "2026-06-07T00:00:00", status: "ok", count: 8 },
        { ts: "2026-06-07T00:00:00", status: "error", count: 2 },
        { ts: "2026-06-07T00:01:00", status: "ok", count: 9 },
      ],
    ]);
    expect(model.valueKeys).toEqual(["s0", "s1"]);
    // Pivoted series labels are sorted.
    expect(model.chartConfig.s0?.label).toBe("error");
    expect(model.chartConfig.s1?.label).toBe("ok");
    expect(model.chartData).toHaveLength(2);
    expect(model.chartData[0]?.s0).toBe(2);
    expect(model.chartData[0]?.s1).toBe(8);
    // "no bar here" stays absent, not 0.
    expect(model.chartData[1]?.s0).toBeUndefined();
  });

  it("pivots remaining string columns on a category axis", () => {
    const model = buildBarChartModel([
      [
        { endpoint: "/users", method: "GET", requests: 10 },
        { endpoint: "/users", method: "POST", requests: 3 },
        { endpoint: "/orders", method: "GET", requests: 7 },
      ],
    ]);
    expect(model.chartConfig.s0?.label).toBe("GET");
    expect(model.chartConfig.s1?.label).toBe("POST");
    expect(model.chartData).toHaveLength(2);
    expect(model.chartData[0]?.s0).toBe(10);
    expect(model.chartData[0]?.s1).toBe(3);
  });

  it("merges queries sharing categories and assigns distinct keys/colors", () => {
    const model = buildBarChartModel([
      [{ service: "api", errors: 4 }],
      [{ service: "api", warnings: 9 }],
    ]);
    expect(model.valueKeys).toEqual(["s0", "s1"]);
    expect(model.chartData).toHaveLength(1);
    expect(model.chartData[0]?.s0).toBe(4);
    expect(model.chartData[0]?.s1).toBe(9);
    expect(model.chartConfig.s0?.color).not.toBe(model.chartConfig.s1?.color);
  });

  it("coerces quoted ClickHouse aggregates to numbers", () => {
    const model = buildBarChartModel([[{ service: "api", count: "42" }]]);
    expect(model.chartData[0]?.s0).toBe(42);
  });

  it("returns an empty model for empty frames", () => {
    const model = buildBarChartModel([[]]);
    expect(model.chartData).toEqual([]);
    expect(model.valueKeys).toEqual([]);
  });
});
