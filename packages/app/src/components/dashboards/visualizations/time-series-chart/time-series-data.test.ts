import { describe, expect, it } from "vitest";
import {
  buildChartModel,
  buildStackedValues,
  type TimeSeriesFrame,
} from "./time-series-data";

// A domain wide enough that no test data is clamped away.
const WIDE: [number, number] = [0, Date.parse("2100-01-01T00:00:00Z")];

const keys = (frame: TimeSeriesFrame) => frame.series.map((s) => s.key);
const values = (frame: TimeSeriesFrame, key: string) =>
  frame.series.find((s) => s.key === key)?.values;
const labels = (frame: TimeSeriesFrame) => frame.series.map((s) => s.label);

describe("buildChartModel", () => {
  it("assigns an opaque render key and keeps the column name as the label", () => {
    const frame = buildChartModel(
      [[{ time: "2026-06-07T00:00:00", value: 5 }]],
      WIDE,
    );
    expect(keys(frame)).toEqual(["s0"]);
    expect(labels(frame)).toEqual(["value"]);
    expect(frame.x[0]).toBeTypeOf("number");
    expect(values(frame, "s0")).toEqual([5]);
  });

  it("skips rows whose timestamp cannot be parsed", () => {
    const frame = buildChartModel(
      [
        [
          { time: "garbage", value: 99 },
          { time: "2026-06-07T00:00:00", value: 5 },
        ],
      ],
      WIDE,
    );
    // The bad row must not become a point at epoch 0.
    expect(frame.x).toHaveLength(1);
    expect(values(frame, "s0")).toEqual([5]);
  });

  it("gives each series a distinct key across two queries and merges by time", () => {
    const frame = buildChartModel(
      [
        [{ time: "2026-06-07T00:00:00", value: 1 }],
        [{ time: "2026-06-07T00:00:00", value: 2 }],
      ],
      WIDE,
    );
    expect(keys(frame)).toEqual(["s0", "s1"]);
    expect(frame.x).toHaveLength(1);
    expect(values(frame, "s0")).toEqual([1]);
    expect(values(frame, "s1")).toEqual([2]);
  });

  it("aligns every series to one timeline, leaving a null where a series has no sample", () => {
    const frame = buildChartModel(
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
    expect(keys(frame)).toEqual(["s0", "s1"]);
    expect(frame.x).toHaveLength(4);
    // Each query samples half the timeline; the other half is a gap, not a
    // value the query never returned.
    expect(values(frame, "s0")).toEqual([1, 2, null, null]);
    expect(values(frame, "s1")).toEqual([null, null, 3, 4]);
  });

  it("assigns distinct colors to series across queries", () => {
    const frame = buildChartModel(
      [
        [{ time: "2026-06-07T00:00:00", value: 1 }],
        [{ time: "2026-06-07T00:00:00", value: 2 }],
      ],
      WIDE,
    );
    expect(frame.series[0]?.color).not.toBe(frame.series[1]?.color);
  });

  it("returns an empty frame for empty input", () => {
    expect(buildChartModel([], WIDE)).toEqual({ x: [], series: [] });
  });

  it("pivots a grouped series into one key per group value", () => {
    const frame = buildChartModel(
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
    expect(keys(frame)).toEqual(["s0", "s1"]);
    expect(labels(frame)).toEqual(["a", "b"]);
    // Rows are merged by timestamp: host a+b at t0, host a at t1.
    expect(frame.x).toHaveLength(2);
    expect(values(frame, "s0")).toEqual([1, 3]);
    // host "b" is absent at t1 — a gap there, not a zero.
    expect(values(frame, "s1")).toEqual([2, null]);
  });

  it("keeps distinct group values that would mangle to the same key separate", () => {
    const frame = buildChartModel(
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
    expect(keys(frame)).toEqual(["s0", "s1"]);
    expect(labels(frame)).toEqual(["a-b", "a b"]); // first-seen group order
    expect(values(frame, "s0")).toEqual([1]);
    expect(values(frame, "s1")).toEqual([2]);
  });

  it("keeps non-identifier column names as the label without mangling the key", () => {
    const frame = buildChartModel(
      [[{ time: "2026-06-07T00:00:00", "count()": "42" }]],
      WIDE,
    );
    // The key identifies the series everywhere it is looked up; the original
    // name, punctuation and all, stays as the label.
    expect(keys(frame)).toEqual(["s0"]);
    expect(labels(frame)).toEqual(["count()"]);
    expect(values(frame, "s0")).toEqual([42]);
  });

  it("detects a series whose first bucket is NULL but later buckets are numeric", () => {
    const frame = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", p99: null },
          { time: "2026-06-07T00:01:00", p99: 12.5 },
        ],
      ],
      WIDE,
    );
    expect(keys(frame)).toEqual(["s0"]);
    expect(labels(frame)).toEqual(["p99"]);
    expect(values(frame, "s0")).toEqual([null, 12.5]);
  });

  it("treats quoted numeric strings (ClickHouse aggregates) as values", () => {
    const frame = buildChartModel(
      [[{ time: "2026-06-07T00:00:00", count: "42" }]],
      WIDE,
    );
    expect(keys(frame)).toEqual(["s0"]);
    expect(values(frame, "s0")).toEqual([42]);
  });

  it("keeps in-domain rows at their real timestamps, even when offset from any grid", () => {
    const minute = 60_000;
    // 13s past the minute boundary: an epoch-aligned grid would drop these.
    const t0 = Date.parse("2026-06-07T00:00:13Z");
    const frame = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:13", value: 1 },
          { time: "2026-06-07T00:01:13", value: 2 },
          { time: "2026-06-07T00:02:13", value: 3 },
        ],
      ],
      [t0 - minute, t0 + 5 * minute],
    );
    expect(frame.x).toEqual([t0, t0 + minute, t0 + 2 * minute]);
    expect(values(frame, "s0")).toEqual([1, 2, 3]);
  });

  it("drops rows outside the domain", () => {
    const minute = 60_000;
    const t1 = Date.parse("2026-06-07T00:01:00Z");
    const frame = buildChartModel(
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
    expect(frame.x).toEqual([t1, t1 + minute]);
    expect(values(frame, "s0")).toEqual([2, 3]);
  });

  it("keeps the leading bucket when its interval overlaps an unaligned domain start", () => {
    const minute = 60_000;
    const t0 = Date.parse("2026-06-07T00:00:00Z");
    const frame = buildChartModel(
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
    // The leading point keeps its real timestamp, left of the axis; the chart
    // pins the axis to the domain and clips the line at the plot edge.
    expect(frame.x[0]).toBe(t0);
    expect(values(frame, "s0")).toEqual([1, 2, 3]);
  });

  it("still drops a lone pre-domain point when no bucket width can be inferred", () => {
    const minute = 60_000;
    const t0 = Date.parse("2026-06-07T00:00:00Z");
    const frame = buildChartModel(
      [[{ time: "2026-06-07T00:00:00", value: 1 }]],
      [t0 + 5 * minute, t0 + 65 * minute],
    );
    expect(frame.x).toHaveLength(0);
  });

  it("breaks a series' line at both edges of a real gap", () => {
    const minute = 60_000;
    const t0 = Date.parse("2026-06-07T00:00:00Z");
    const frame = buildChartModel(
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
    // A marker one bucket after the gap opens and one before it closes, so the
    // line leaves and re-enters the gap at its edges instead of arcing across.
    expect(frame.x).toEqual([
      t0,
      t0 + minute,
      t0 + 2 * minute,
      t0 + 3 * minute,
      t0 + 4 * minute,
      t0 + 9 * minute,
      t0 + 10 * minute,
    ]);
    expect(values(frame, "s0")).toEqual([1, 2, 3, 4, null, null, 5]);
  });
});

describe("buildStackedValues", () => {
  it("accumulates in series order, counting a missing sample as no contribution", () => {
    const frame = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", a: 1, b: 10 },
          { time: "2026-06-07T00:01:00", a: 2, b: "oops" }, // non-numeric → null
        ],
        [{ time: "2026-06-07T00:00:00", c: 100 }], // absent at 00:01
      ],
      WIDE,
    );
    // Running totals: a, then a+b, then a+b+c. At 00:01 only `a` reports, so
    // both bands above it sit flat on it rather than breaking the stack.
    expect(buildStackedValues(frame.series)).toEqual([
      [1, 2],
      [11, 2],
      [111, 2],
    ]);
  });
});
