import { describe, expect, it } from "vite-plus/test";
import { buildHistogramQuery, fillHistogramBuckets } from "./histogram";

// Bucket-width selection (`bucketSeconds`) is shared with the dashboards panel
// step and covered by `@everr/ui/lib/bucket`'s own tests.

describe("buildHistogramQuery", () => {
  it("inlines the chosen interval seconds into the SQL", () => {
    const built = buildHistogramQuery({
      timeRange: { from: "2026-03-09T00:00:00Z", to: "2026-03-09T01:00:00Z" },
      levels: [],
      services: [],
      attributes: [],
      histogramBuckets: 60,
      utcOffsetMinutes: 0,
    });
    expect(built.sql).toContain("INTERVAL 60 SECOND");
  });
});

describe("fillHistogramBuckets", () => {
  it("fills missing buckets with zeros", () => {
    const from = new Date("2026-03-09T00:00:00Z");
    const to = new Date("2026-03-09T00:02:00Z");
    const buckets = fillHistogramBuckets([], from, to, 60, 0);
    expect(buckets.length).toBeGreaterThanOrEqual(2);
    expect(buckets.every((b) => b.total === 0)).toBe(true);
  });

  it("starts day buckets at the viewer's midnight", () => {
    const from = new Date("2026-11-17T05:00:00Z");
    const to = new Date("2026-11-19T15:00:00Z");
    const buckets = fillHistogramBuckets([], from, to, 86400, -300);
    expect(buckets.map((b) => b.timestamp)).toEqual([
      "2026-11-17T05:00:00.000Z",
      "2026-11-18T05:00:00.000Z",
      "2026-11-19T05:00:00.000Z",
    ]);
  });
});
