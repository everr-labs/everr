import { describe, expect, it } from "vitest";
import { buildChartModel } from "./time-series-data";

const TS_KEY = "__ts";

describe("buildChartModel", () => {
  it("assigns an opaque render key and keeps the column name as the label", () => {
    const model = buildChartModel(
      [[{ time: "2026-06-07T00:00:00", value: 5 }]],
      undefined,
    );
    expect(model.valueKeys).toEqual(["s0"]);
    expect(model.chartConfig.s0?.label).toBe("value");
    expect(model.chartData[0]?.[TS_KEY]).toBeTypeOf("number");
    expect(model.chartData[0]?.s0).toBe(5);
  });

  it("gives each series a distinct key across two queries and merges by time", () => {
    const model = buildChartModel(
      [
        [{ time: "2026-06-07T00:00:00", value: 1 }],
        [{ time: "2026-06-07T00:00:00", value: 2 }],
      ],
      undefined,
    );
    expect(model.valueKeys).toEqual(["s0", "s1"]);
    expect(model.chartData).toHaveLength(1);
    expect(model.chartData[0]?.s0).toBe(1);
    expect(model.chartData[0]?.s1).toBe(2);
  });

  it("assigns distinct colors to series across queries", () => {
    const model = buildChartModel(
      [
        [{ time: "2026-06-07T00:00:00", value: 1 }],
        [{ time: "2026-06-07T00:00:00", value: 2 }],
      ],
      undefined,
    );
    expect(model.chartConfig.s0?.color).not.toBe(model.chartConfig.s1?.color);
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
    // One opaque key per group value, in sorted group order (a, b).
    expect(model.valueKeys).toEqual(["s0", "s1"]);
    expect(model.chartConfig.s0?.label).toBe("a");
    expect(model.chartConfig.s1?.label).toBe("b");
    // Rows are merged by timestamp: host a+b at t0, host a at t1.
    expect(model.chartData).toHaveLength(2);
    expect(model.chartData[0]?.s0).toBe(1);
    expect(model.chartData[0]?.s1).toBe(2);
    expect(model.chartData[1]?.s0).toBe(3);
  });

  it("keeps distinct group values that would mangle to the same key separate", () => {
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", host: "a-b", value: 1 },
          { time: "2026-06-07T00:00:00", host: "a b", value: 2 },
        ],
      ],
      undefined,
    );
    // "a-b" and "a b" both sanitize to "a_b"; opaque keys keep them apart so
    // neither series overwrites the other.
    expect(model.valueKeys).toEqual(["s0", "s1"]);
    const labels = model.valueKeys.map((k) => model.chartConfig[k]?.label);
    expect(labels).toEqual(["a b", "a-b"]); // sorted group order
    expect(model.chartData[0]?.s0).toBe(2); // "a b"
    expect(model.chartData[0]?.s1).toBe(1); // "a-b"
  });

  it("keeps non-identifier column names as the label without mangling the key", () => {
    const model = buildChartModel(
      [[{ time: "2026-06-07T00:00:00", "count()": "42" }]],
      undefined,
    );
    // `count()` as a render key would produce `var(--color-count())` (invalid);
    // the opaque key sidesteps that and the original name stays as the label.
    expect(model.valueKeys).toEqual(["s0"]);
    expect(model.chartConfig.s0?.label).toBe("count()");
    expect(model.chartData[0]?.s0).toBe(42);
  });

  it("treats quoted numeric strings (ClickHouse aggregates) as values", () => {
    const model = buildChartModel(
      [[{ time: "2026-06-07T00:00:00", count: "42" }]],
      undefined,
    );
    expect(model.valueKeys).toEqual(["s0"]);
    expect(model.chartData[0]?.s0).toBe(42);
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
    expect(model.chartData.map((r) => r.s0)).toEqual([1, 2, 3]);
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
    expect(model.chartData.map((r) => r.s0)).toEqual([2, 3]);
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
    expect(model.chartData.filter((r) => r.s0 === null)).toHaveLength(1);
  });
});
