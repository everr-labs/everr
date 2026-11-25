import { describe, expect, it } from "vite-plus/test";
import { buildChartModel, type ChartModel, type ChartSeries, samplesAt } from "./time-series-data";

/** A line's points as `[time, value]`, null where there is no number. */
function points(series: ChartSeries | undefined): [number, number | null][] {
  return Array.from(series?.times ?? [], (time, i) => {
    const value = series?.values[i] ?? Number.NaN;
    return [time, Number.isNaN(value) ? null : value];
  });
}

/** A line's values, null where there is no number. */
function values(series: ChartSeries | undefined): (number | null)[] {
  return points(series).map(([, value]) => value);
}

/** What each series has at the timeline's `index`th time, by series id. */
function at(model: ChartModel, index: number): Record<string, number> {
  return samplesAt(model.series, model.times[index] ?? Number.NaN);
}

// A domain wide enough that no test data is clamped away.
const WIDE: [number, number] = [0, Date.parse("2100-01-01T00:00:00Z")];

describe("buildChartModel", () => {
  it("assigns an opaque render key and keeps the column name as the label", () => {
    const model = buildChartModel([[{ time: "2026-06-07T00:00:00", value: 5 }]], WIDE);
    expect(model.series.map((item) => item.id)).toEqual(["s0"]);
    expect(model.series[0]?.label).toBe("value");
    expect(model.times[0]).toBeTypeOf("number");
    expect(at(model, 0).s0).toBe(5);
    expect(values(model.series[0])[0]).toBe(5);
  });

  it("skips rows whose timestamp cannot be parsed", () => {
    const model = buildChartModel(
      [
        [
          { time: "garbage", value: 99 },
          { time: "2026-06-07T00:00:00", value: 5 },
        ],
      ],
      WIDE,
    );
    // The bad row must not become a point at epoch 0.
    expect(model.times).toHaveLength(1);
    expect(at(model, 0).s0).toBe(5);
    expect(points(model.series[0])).toHaveLength(1);
  });

  it("gives each series a distinct key across two queries and merges by time", () => {
    const model = buildChartModel(
      [[{ time: "2026-06-07T00:00:00", value: 1 }], [{ time: "2026-06-07T00:00:00", value: 2 }]],
      WIDE,
    );
    expect(model.series.map((item) => item.id)).toEqual(["s0", "s1"]);
    expect(model.times).toHaveLength(1);
    expect(at(model, 0).s0).toBe(1);
    expect(at(model, 0).s1).toBe(2);
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
      WIDE,
    );
    expect(model.series.map((item) => item.id)).toEqual(["s0", "s1"]);
    // Each series' own array holds only its own points — the other query's
    // timestamps are absent, not undefined holes that would break the line.
    expect(values(model.series[0])).toEqual([1, 2]);
    expect(points(model.series[0])).toHaveLength(2);
    expect(values(model.series[1])).toEqual([3, 4]);
    expect(points(model.series[1])).toHaveLength(2);
    // The merged timeline still carries every timestamp for the crosshair.
    expect(model.times).toHaveLength(4);
  });

  it("assigns distinct colors to series across queries", () => {
    const model = buildChartModel(
      [[{ time: "2026-06-07T00:00:00", value: 1 }], [{ time: "2026-06-07T00:00:00", value: 2 }]],
      WIDE,
    );
    expect(model.series[0]?.color).not.toBe(model.series[1]?.color);
  });

  it("pins named series to their configured color and keeps the palette for the rest", () => {
    const rows = [{ time: "2026-06-07T00:00:00", logs: 1, traces: 2 }];
    const unpinned = buildChartModel([rows], WIDE);
    const pinned = buildChartModel([rows], WIDE, { logs: "#123456" });
    expect(pinned.series[0]?.color).toBe("#123456");
    expect(pinned.series[1]?.color).toBe(unpinned.series[1]?.color);
  });

  it("returns an empty model for empty input", () => {
    expect(buildChartModel([], WIDE)).toEqual({
      times: new Float64Array(0),
      series: [],
      domain: WIDE,
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
      WIDE,
    );
    // One opaque key per group value, in the order the rows arrived (a, b).
    expect(model.series.map((item) => item.id)).toEqual(["s0", "s1"]);
    expect(model.series[0]?.label).toBe("a");
    expect(model.series[1]?.label).toBe("b");
    // Rows are merged by timestamp: host a+b at t0, host a at t1.
    expect(model.times).toHaveLength(2);
    expect(at(model, 0).s0).toBe(1);
    expect(at(model, 0).s1).toBe(2);
    expect(at(model, 1).s0).toBe(3);
    // host "b" only has a point at t0 — its line data is that one point, not a
    // hole at t1.
    expect(values(model.series[1])).toEqual([2]);
    expect(values(model.series[0])).toEqual([1, 3]);
  });

  it("keeps distinct group values that would mangle to the same key separate", () => {
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", host: "a-b", value: 1 },
          { time: "2026-06-07T00:00:00", host: "a b", value: 2 },
        ],
      ],
      WIDE,
    );
    // "a-b" and "a b" both sanitize to "a_b"; opaque keys keep them apart so
    // neither series overwrites the other.
    expect(model.series.map((item) => item.id)).toEqual(["s0", "s1"]);
    const labels = model.series.map((item) => item.label);
    expect(labels).toEqual(["a-b", "a b"]); // first-seen group order
    expect(at(model, 0).s0).toBe(1); // "a-b"
    expect(at(model, 0).s1).toBe(2); // "a b"
  });

  it("keeps non-identifier column names as the label without mangling the key", () => {
    const model = buildChartModel([[{ time: "2026-06-07T00:00:00", "count()": "42" }]], WIDE);
    // The chart id stays separate from the original column label.
    expect(model.series.map((item) => item.id)).toEqual(["s0"]);
    expect(model.series[0]?.label).toBe("count()");
    expect(at(model, 0).s0).toBe(42);
  });

  it("detects a series whose first bucket is NULL but later buckets are numeric", () => {
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", p99: null },
          { time: "2026-06-07T00:01:00", p99: 12.5 },
        ],
      ],
      WIDE,
    );
    expect(model.series.map((item) => item.id)).toEqual(["s0"]);
    expect(model.series[0]?.label).toBe("p99");
    expect(at(model, 1).s0).toBe(12.5);
  });

  it("treats quoted numeric strings (ClickHouse aggregates) as values", () => {
    const model = buildChartModel([[{ time: "2026-06-07T00:00:00", count: "42" }]], WIDE);
    expect(model.series.map((item) => item.id)).toEqual(["s0"]);
    expect(at(model, 0).s0).toBe(42);
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
    expect(points(model.series[0])).toHaveLength(3);
    expect(values(model.series[0])).toEqual([1, 2, 3]);
    expect(model.series[0]?.times[0]).toBe(t0);
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
    expect(values(model.series[0])).toEqual([2, 3]);
    expect(Array.from(model.times, (_, i) => at(model, i).s0)).toEqual([2, 3]);
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
    expect(values(model.series[0])).toEqual([1, 2, 3]);
    expect(model.series[0]?.times[0]).toBe(t0);
    // The merged crosshair/tooltip timeline stays strictly in-domain: the
    // off-axis point renders (clipped) but is not hoverable.
    expect(Array.from(model.times, (_, i) => at(model, i).s0)).toEqual([2, 3]);
  });

  it("still drops a lone pre-domain point when no bucket width can be inferred", () => {
    const minute = 60_000;
    const t0 = Date.parse("2026-06-07T00:00:00Z");
    const model = buildChartModel(
      [[{ time: "2026-06-07T00:00:00", value: 1 }]],
      [t0 + 5 * minute, t0 + 65 * minute],
    );
    expect(points(model.series[0])).toHaveLength(0);
    expect(model.times).toHaveLength(0);
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
    expect(points(model.series[0])).toHaveLength(6);
    expect(values(model.series[0]).filter((value) => value === null)).toHaveLength(1);
    expect(model.times).toHaveLength(5);
  });

  it("puts rows that arrive out of order back in time order", () => {
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:02:00", value: 3 },
          { time: "2026-06-07T00:00:00", value: 1 },
          { time: "2026-06-07T00:01:00", value: 2 },
        ],
      ],
      WIDE,
    );
    expect(values(model.series[0])).toEqual([1, 2, 3]);
    expect(Array.from(model.times)).toEqual(points(model.series[0]).map(([time]) => time));
  });

  it("keeps the last of the rows that share a series and a time", () => {
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", host: "a", value: 1 },
          { time: "2026-06-07T00:01:00", host: "a", value: 2 },
          { time: "2026-06-07T00:00:00", host: "a", value: 9 },
        ],
      ],
      WIDE,
    );
    expect(values(model.series[0])).toEqual([9, 2]);
    expect(model.times).toHaveLength(2);
  });

  it("keeps a sample that is not a number as a break in its line", () => {
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", a: 1, b: 10 },
          { time: "2026-06-07T00:01:00", a: 2, b: "oops" },
          { time: "2026-06-07T00:02:00", a: 3, b: 30 },
        ],
      ],
      WIDE,
    );
    expect(values(model.series[1])).toEqual([10, null, 30]);
    // The tooltip lists a series only where it has a number.
    expect(at(model, 1)).toEqual({ s0: 2 });
  });

  it("names a series after every group column, even one named like the time column", () => {
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", host: "time", zone: "eu", value: 1 },
          { time: "2026-06-07T00:00:00", host: "b", zone: null, value: 2 },
        ],
      ],
      WIDE,
    );
    expect(model.series.map(({ label }) => label)).toEqual(["time · eu", "b · "]);
    expect(at(model, 0)).toEqual({ s0: 1, s1: 2 });
  });

  it("merges the timestamps of series sampled at different times into one timeline", () => {
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", host: "a", value: 1 },
          { time: "2026-06-07T00:00:30", host: "b", value: 2 },
          { time: "2026-06-07T00:01:00", host: "a", value: 3 },
          { time: "2026-06-07T00:01:00", host: "b", value: 4 },
        ],
      ],
      WIDE,
    );
    expect(model.times).toHaveLength(3);
    expect(Array.from(model.times, (_, i) => at(model, i))).toEqual([
      { s0: 1 },
      { s1: 2 },
      { s0: 3, s1: 4 },
    ]);
  });
});
