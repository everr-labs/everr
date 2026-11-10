import { describe, expect, it } from "vite-plus/test";
import { buildHeatmapModel } from "./heatmap-data";
import { heatmapSpec } from "./spec";

const DOMAIN: [number, number] = [0, 100_000];

function specWith(overrides: Record<string, unknown> = {}) {
  return heatmapSpec.parse(overrides);
}

// Timestamps below 1e12 are treated as epoch seconds by toTimestamp, so test
// rows use second-precision epochs (domain ms = ts × 1000).
const ts = (seconds: number) => seconds;

describe("buildHeatmapModel", () => {
  it("builds a time × bucket grid from long-format rows", () => {
    const model = buildHeatmapModel(
      [
        [
          { ts: ts(10), route: "/api", count: 3 },
          { ts: ts(10), route: "/web", count: 1 },
          { ts: ts(50), route: "/api", count: 7 },
        ],
      ],
      specWith(),
      DOMAIN,
    );
    expect(model.yBuckets).toEqual(["/api", "/web"]);
    // step = 40s gap between the two distinct timestamps
    expect(model.cells).toEqual([
      { start: 10_000, end: 50_000, bucket: 0, column: 1, value: 3, samples: 1 },
      { start: 10_000, end: 50_000, bucket: 1, column: 1, value: 1, samples: 1 },
      { start: 50_000, end: 90_000, bucket: 0, column: 2, value: 7, samples: 1 },
    ]);
    expect(model.domain).toEqual([0, 7]);
    // Columns on the samples' 40s grid, extended to cover the whole range.
    expect(model.columns).toEqual({ start: -30_000, step: 40_000, count: 4 });
  });

  it.each([
    ["numeric ones descending, like a y-axis", [50, "500", 100], ["500", "100", "50"]],
    ["named ones in first-seen order", ["error", "info"], ["error", "info"]],
  ])("orders buckets: %s", (_, buckets, expected) => {
    const rows = buckets.map((bucket) => ({ ts: ts(10), bucket, count: 1 }));
    expect(buildHeatmapModel([rows], specWith(), DOMAIN).yBuckets).toEqual(expected);
  });

  it("honors yColumn and valueColumn over column-order defaults", () => {
    const model = buildHeatmapModel(
      [
        [
          { ts: ts(10), errors: 9, service: "api", requests: 4 },
          { ts: ts(50), errors: 2, service: "db", requests: 6 },
        ],
      ],
      specWith({ yColumn: "service", valueColumn: "requests" }),
      DOMAIN,
    );
    expect(model.yBuckets).toEqual(["api", "db"]);
    expect(model.cells.map((c) => c.value)).toEqual([4, 6]);
  });

  it("sums rows landing on the same cell, within and across frames", () => {
    const model = buildHeatmapModel(
      [
        [
          { ts: ts(10), route: "/api", count: 3 },
          // ClickHouse quotes 64-bit aggregates.
          { ts: ts(10), route: "/api", count: "2" },
          // Rows with no bucket or no value are skipped.
          { ts: ts(10), route: null, count: 1 },
          { ts: ts(10), route: "/api", count: null },
        ],
        [{ ts: ts(10), route: "/api", count: 5 }],
      ],
      specWith(),
      DOMAIN,
    );
    // A lone timestamp's column is the whole range.
    expect(model.cells).toMatchObject([{ start: 0, end: 100_000, bucket: 0, value: 10 }]);
    expect(model.columns).toEqual({ start: 0, step: 100_000, count: 1 });
  });

  it("sizes columns on the regular interval despite a stray sample", () => {
    const rows = [0, 10, 20, 20.001, 30].map((s) => ({ ts: ts(s), route: "/api", count: 1 }));
    const model = buildHeatmapModel([rows], specWith(), DOMAIN);
    expect(model.columns.step).toBe(10_000);
    // The stray sample shares its neighbor's column, and they sum.
    expect(model.cells.map((cell) => cell.value)).toEqual([1, 1, 2, 1]);
  });

  it("keeps jittered samples in their own columns", () => {
    // Every ~58s: 2s and 59s in one column would leave the next one empty.
    const rows = [2, 59, 121, 179].map((s) => ({ ts: ts(s), route: "/api", count: 1 }));
    const model = buildHeatmapModel([rows], specWith(), [0, 240_000]);
    // Column 0 is the stretch before the first sample, to the range's start.
    expect(model.cells.map((cell) => [cell.column, cell.value])).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
    ]);
  });

  it("lets buckets sampled at offset times share columns", () => {
    // Each route every 10s, /web a second after /api.
    const rows = [0, 10, 20].flatMap((s) => [
      { ts: ts(s), route: "/api", count: 1 },
      { ts: ts(s + 1), route: "/web", count: 1 },
    ]);
    const model = buildHeatmapModel([rows], specWith(), DOMAIN);
    expect(model.columns.step).toBe(10_000);
    expect(model.cells.map((cell) => [cell.column, cell.bucket])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
      [2, 1],
    ]);
  });

  it("merges the same number of samples into every column past the column cap", () => {
    // A day of minute samples is more columns than any panel is wide.
    const day: [number, number] = [0, 86_400_000];
    const rows = Array.from({ length: 1440 }, (_, m) => ({
      ts: ts(m * 60),
      route: "/api",
      count: 1,
    }));
    const model = buildHeatmapModel([rows], specWith(), day);
    expect(new Set(model.cells.map(({ value, samples }) => [value, samples].join()))).toEqual(
      new Set(["2,2"]),
    );
  });

  it("clamps cells to the domain and drops fully outside ones", () => {
    const model = buildHeatmapModel(
      [
        [
          { ts: ts(90), route: "/api", count: 1 },
          { ts: ts(120), route: "/api", count: 2 },
        ],
      ],
      specWith(),
      DOMAIN,
    );
    // step = 30s; the 90s cell clamps to the domain end, the 120s one is out
    expect(model.cells).toMatchObject([{ start: 90_000, end: 100_000, bucket: 0, value: 1 }]);
  });

  it("floors the default color domain at 0 and honors explicit min/max", () => {
    const frames = [[{ ts: ts(10), route: "/api", count: 5 }]];
    expect(buildHeatmapModel(frames, specWith(), DOMAIN).domain).toEqual([0, 5]);
    expect(buildHeatmapModel(frames, specWith({ min: 2, max: 100 }), DOMAIN).domain).toEqual([
      2, 100,
    ]);
  });
});
