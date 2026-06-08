import { describe, expect, it } from "vitest";
import { buildChartModel } from "./time-series-data";

const TS_KEY = "__ts";

describe("buildChartModel", () => {
  it("keeps a single query's value keys unprefixed", () => {
    const model = buildChartModel(
      [[{ time: "2026-06-07T00:00:00", value: 5 }]],
      undefined,
    );
    expect(model.valueKeys).toEqual(["value"]);
    expect(model.chartData[0]?.[TS_KEY]).toBeTypeOf("number");
    expect(model.chartData[0]?.value).toBe(5);
  });

  it("namespaces colliding value keys across two queries and merges by time", () => {
    const model = buildChartModel(
      [
        [{ time: "2026-06-07T00:00:00", value: 1 }],
        [{ time: "2026-06-07T00:00:00", value: 2 }],
      ],
      undefined,
    );
    expect(model.valueKeys).toEqual(["q0__value", "q1__value"]);
    expect(model.chartData).toHaveLength(1);
    expect(model.chartData[0]?.q0__value).toBe(1);
    expect(model.chartData[0]?.q1__value).toBe(2);
  });

  it("assigns distinct colors to series across queries", () => {
    const model = buildChartModel(
      [
        [{ time: "2026-06-07T00:00:00", value: 1 }],
        [{ time: "2026-06-07T00:00:00", value: 2 }],
      ],
      undefined,
    );
    expect(model.chartConfig.q0__value?.color).not.toBe(
      model.chartConfig.q1__value?.color,
    );
  });

  it("returns an empty model for empty input", () => {
    expect(buildChartModel([], undefined)).toEqual({
      chartData: [],
      valueKeys: [],
      chartConfig: {},
    });
  });

  it("pivots a grouped series into one key per group value", () => {
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", host: "a", value: 1 },
          { time: "2026-06-07T00:00:00", host: "b", value: 2 },
          { time: "2026-06-07T00:01:00", host: "a", value: 3 },
        ],
      ],
      undefined,
    );
    // Series keys are the sanitized group values, sorted.
    expect(model.valueKeys).toEqual(["a", "b"]);
    // Rows are merged by timestamp: host a+b at t0, host a at t1.
    expect(model.chartData).toHaveLength(2);
    expect(model.chartData[0]?.a).toBe(1);
    expect(model.chartData[0]?.b).toBe(2);
    expect(model.chartData[1]?.a).toBe(3);
  });

  it("sanitizes value-column names so they form valid CSS/dataKey identifiers", () => {
    const model = buildChartModel(
      [[{ time: "2026-06-07T00:00:00", "count()": "42" }]],
      undefined,
    );
    // `count()` would render as `var(--color-count())` (invalid) and blank the
    // line; the render key is sanitized and the original kept as the label.
    expect(model.valueKeys).toEqual(["count__"]);
    expect(model.chartConfig.count__?.label).toBe("count()");
    expect(model.chartData[0]?.count__).toBe(42);
  });

  it("treats quoted numeric strings (ClickHouse aggregates) as values", () => {
    const model = buildChartModel(
      [[{ time: "2026-06-07T00:00:00", count: "42" }]],
      undefined,
    );
    expect(model.valueKeys).toEqual(["count"]);
    expect(model.chartData[0]?.count).toBe(42);
  });

  it("keeps in-domain rows at their real timestamps, even when offset from any grid", () => {
    const minute = 60_000;
    // 13s past the minute boundary: an epoch-aligned grid would drop these.
    const t0 = Date.parse("2026-06-07T00:00:13Z");
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:13", value: 1 },
          { time: "2026-06-07T00:01:13", value: 2 },
          { time: "2026-06-07T00:02:13", value: 3 },
        ],
      ],
      [t0 - minute, t0 + 5 * minute],
    );
    expect(model.chartData).toHaveLength(3);
    expect(model.chartData.map((r) => r.value)).toEqual([1, 2, 3]);
    expect(model.chartData[0]?.[TS_KEY]).toBe(t0);
  });

  it("drops rows outside the domain", () => {
    const minute = 60_000;
    const t1 = Date.parse("2026-06-07T00:01:00Z");
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", value: 1 }, // before the domain
          { time: "2026-06-07T00:01:00", value: 2 },
          { time: "2026-06-07T00:02:00", value: 3 },
        ],
      ],
      [t1, t1 + 5 * minute],
    );
    expect(model.chartData.map((r) => r.value)).toEqual([2, 3]);
  });

  it("inserts a single null marker to break the line across a real gap", () => {
    const minute = 60_000;
    const t0 = Date.parse("2026-06-07T00:00:00Z");
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", value: 1 },
          { time: "2026-06-07T00:01:00", value: 2 },
          { time: "2026-06-07T00:02:00", value: 3 },
          { time: "2026-06-07T00:03:00", value: 4 },
          { time: "2026-06-07T00:10:00", value: 5 }, // 7-minute gap
        ],
      ],
      [t0, t0 + 15 * minute],
    );
    // 5 real rows + 1 null gap marker.
    expect(model.chartData).toHaveLength(6);
    expect(model.chartData.filter((r) => r.value === null)).toHaveLength(1);
  });
});
