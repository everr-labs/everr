import { describe, expect, it } from "vitest";
import {
  bucketSeconds,
  buildHistogramQuery,
  fillHistogramBuckets,
} from "./histogram";

describe("bucketSeconds", () => {
  it("picks the smallest interval >= ideal", () => {
    const from = new Date("2026-03-09T00:00:00Z");
    const to = new Date("2026-03-09T01:00:00Z");
    expect(bucketSeconds(from, to, 60)).toBe(60);
  });

  it("falls back to the largest interval when range is huge", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-12-31T00:00:00Z");
    expect(bucketSeconds(from, to, 80)).toBe(24 * 60 * 60);
  });
});

describe("buildHistogramQuery", () => {
  it("inlines the chosen interval seconds into the SQL", () => {
    const built = buildHistogramQuery({
      timeRange: { from: "2026-03-09T00:00:00Z", to: "2026-03-09T01:00:00Z" },
      levels: [],
      services: [],
      repos: [],
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
