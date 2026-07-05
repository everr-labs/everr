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
      { start: 10_000, end: 50_000, bucket: 0, value: 3 },
      { start: 10_000, end: 50_000, bucket: 1, value: 1 },
      { start: 50_000, end: 90_000, bucket: 0, value: 7 },
    ]);
    expect(model.domain).toEqual([0, 7]);
  });

  it("sorts all-numeric buckets descending (largest at the top)", () => {
    const model = buildHeatmapModel(
      [
        [
          { ts: ts(10), bucket: 50, count: 1 },
          { ts: ts(10), bucket: 500, count: 2 },
          { ts: ts(10), bucket: 100, count: 3 },
        ],
      ],
      specWith(),
      DOMAIN,
    );
    expect(model.yBuckets).toEqual(["500", "100", "50"]);
  });

  it("keeps categorical buckets in first-seen order", () => {
    const model = buildHeatmapModel(
      [
        [
          { ts: ts(10), severity: "error", count: 1 },
          { ts: ts(10), severity: "info", count: 2 },
        ],
      ],
      specWith(),
      DOMAIN,
    );
    expect(model.yBuckets).toEqual(["error", "info"]);
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
          { ts: ts(10), route: "/api", count: 2 },
        ],
        [{ ts: ts(10), route: "/api", count: 5 }],
      ],
      specWith(),
      DOMAIN,
    );
    expect(model.cells).toEqual([{ start: 10_000, end: 100_000, bucket: 0, value: 10 }]);
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
    expect(model.cells).toEqual([{ start: 90_000, end: 100_000, bucket: 0, value: 1 }]);
  });

  it("floors the default color domain at 0 and honors explicit min/max", () => {
    const frames = [[{ ts: ts(10), route: "/api", count: 5 }]];
    expect(buildHeatmapModel(frames, specWith(), DOMAIN).domain).toEqual([0, 5]);
    expect(buildHeatmapModel(frames, specWith({ min: 2, max: 100 }), DOMAIN).domain).toEqual([
      2, 100,
    ]);
  });

  it("skips rows with a null bucket or non-numeric value", () => {
    const model = buildHeatmapModel(
      [
        [
          { ts: ts(10), route: null, count: 1 },
          { ts: ts(10), route: "/api", count: null },
          { ts: ts(10), route: "/api", count: 4 },
        ],
      ],
      specWith(),
      DOMAIN,
    );
    expect(model.cells).toEqual([{ start: 10_000, end: 100_000, bucket: 0, value: 4 }]);
  });

  it("returns an empty model without a time column", () => {
    const model = buildHeatmapModel([[{ route: "/api", count: 1 }]], specWith(), DOMAIN);
    expect(model.cells).toEqual([]);
    expect(model.yBuckets).toEqual([]);
  });

  it("reads ClickHouse quoted numerics for values and buckets", () => {
    const model = buildHeatmapModel(
      [
        [
          { ts: ts(10), bucket: "100", count: "3" },
          { ts: ts(10), bucket: "50", count: "1" },
        ],
      ],
      specWith(),
      DOMAIN,
    );
    expect(model.yBuckets).toEqual(["100", "50"]);
    expect(model.cells.map((c) => c.value)).toEqual([3, 1]);
  });
});
