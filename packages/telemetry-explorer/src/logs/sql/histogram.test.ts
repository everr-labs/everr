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
    });
    expect(built.sql).toContain("INTERVAL 60 SECOND");
  });
});

describe("fillHistogramBuckets", () => {
  it("fills missing buckets with zeros", () => {
    const from = new Date("2026-03-09T00:00:00Z");
    const to = new Date("2026-03-09T00:02:00Z");
    const buckets = fillHistogramBuckets([], from, to, 60);
    expect(buckets.length).toBeGreaterThanOrEqual(2);
    expect(buckets.every((b) => b.total === 0)).toBe(true);
  });
});
