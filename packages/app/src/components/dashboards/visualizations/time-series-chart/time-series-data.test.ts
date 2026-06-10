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
    expect(model.seriesData.s0?.[0]?.s0).toBe(5);
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

  it("renders each series from its own data so non-overlapping query timestamps don't break lines", () => {
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", value: 1 },
          { time: "2026-06-07T00:01:00", value: 2 },
        ],
        [
          { time: "2026-06-07T00:02:00", value: 3 },
          { time: "2026-06-07T00:03:00", value: 4 },
        ],
      ],
      undefined,
    );
    expect(model.valueKeys).toEqual(["s0", "s1"]);
    // Each series' own array holds only its own points — the other query's
    // timestamps are absent, not undefined holes that would break the line.
    expect(model.seriesData.s0?.map((r) => r.s0)).toEqual([1, 2]);
    expect(model.seriesData.s0).toHaveLength(2);
    expect(model.seriesData.s1?.map((r) => r.s1)).toEqual([3, 4]);
    expect(model.seriesData.s1).toHaveLength(2);
    // The merged timeline still carries every timestamp for the crosshair.
    expect(model.chartData).toHaveLength(4);
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
      seriesData: {},
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
    // host "b" only has a point at t0 — its line data is that one point, not a
    // hole at t1.
    expect(model.seriesData.s1?.map((r) => r.s1)).toEqual([2]);
    expect(model.seriesData.s0?.map((r) => r.s0)).toEqual([1, 3]);
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

  it("detects a series whose first bucket is NULL but later buckets are numeric", () => {
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", p99: null },
          { time: "2026-06-07T00:01:00", p99: 12.5 },
        ],
      ],
      undefined,
    );
    expect(model.valueKeys).toEqual(["s0"]);
    expect(model.chartConfig.s0?.label).toBe("p99");
    expect(model.chartData[1]?.s0).toBe(12.5);
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
    expect(model.seriesData.s0).toHaveLength(3);
    expect(model.seriesData.s0?.map((r) => r.s0)).toEqual([1, 2, 3]);
    expect(model.seriesData.s0?.[0]?.[TS_KEY]).toBe(t0);
  });

  it("drops rows outside the domain", () => {
    const minute = 60_000;
    const t1 = Date.parse("2026-06-07T00:01:00Z");
    const model = buildChartModel(
      [
        [
          // Before the domain, and its bucket [00:00, 00:01) ends exactly at
          // the domain start — no overlap, so it stays dropped.
          { time: "2026-06-07T00:00:00", value: 1 },
          { time: "2026-06-07T00:01:00", value: 2 },
          { time: "2026-06-07T00:02:00", value: 3 },
        ],
      ],
      [t1, t1 + 5 * minute],
    );
    expect(model.seriesData.s0?.map((r) => r.s0)).toEqual([2, 3]);
    expect(model.chartData.map((r) => r.s0)).toEqual([2, 3]);
  });

  it("keeps the leading bucket when its interval overlaps an unaligned domain start", () => {
    const minute = 60_000;
    const t0 = Date.parse("2026-06-07T00:00:00Z");
    const model = buildChartModel(
      [
        [
          // 30m buckets; the domain starts mid-bucket at 00:05, so the 00:00
          // bucket covers in-range rows (00:05–00:30) and must survive.
          { time: "2026-06-07T00:00:00", value: 1 },
          { time: "2026-06-07T00:30:00", value: 2 },
          { time: "2026-06-07T01:00:00", value: 3 },
        ],
      ],
      [t0 + 5 * minute, t0 + 95 * minute],
    );
    expect(model.seriesData.s0?.map((r) => r.s0)).toEqual([1, 2, 3]);
    expect(model.seriesData.s0?.[0]?.[TS_KEY]).toBe(t0);
    // The merged crosshair/tooltip timeline stays strictly in-domain: the
    // off-axis point renders (clipped) but is not hoverable.
    expect(model.chartData.map((r) => r.s0)).toEqual([2, 3]);
  });

  it("still drops a lone pre-domain point when no bucket width can be inferred", () => {
    const minute = 60_000;
    const t0 = Date.parse("2026-06-07T00:00:00Z");
    const model = buildChartModel(
      [[{ time: "2026-06-07T00:00:00", value: 1 }]],
      [t0 + 5 * minute, t0 + 65 * minute],
    );
    expect(model.seriesData.s0 ?? []).toHaveLength(0);
    expect(model.chartData).toHaveLength(0);
  });

  it("inserts a single null marker into a series to break the line across a real gap", () => {
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
    // The gap marker lives in the per-series data (5 real points + 1 null),
    // not in the merged crosshair timeline (5 points).
    expect(model.seriesData.s0).toHaveLength(6);
    expect(model.seriesData.s0?.filter((r) => r.s0 === null)).toHaveLength(1);
    expect(model.chartData).toHaveLength(5);
  });
});
