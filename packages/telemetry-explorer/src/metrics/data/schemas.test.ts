import { describe, expect, it } from "vite-plus/test";
import { MetricSeriesInputSchema, MetricsSearchSchema } from "./schemas";

describe("MetricsSearchSchema", () => {
  it("keeps the first query when a link repeats a letter", () => {
    const first = { id: "B", metric: "http.requests", type: "sum" };
    const second = { id: "B", metric: "queue.depth", type: "gauge" };
    const { queries } = MetricsSearchSchema.parse({ queries: [first, second] });
    expect(queries.map((q) => q.metric)).toEqual(["http.requests"]);
  });
});

describe("MetricSeriesInputSchema", () => {
  it("rejects a time range that ends before it starts", () => {
    const input = {
      timeRange: { from: "2026-01-01T12:05:00Z", to: "2026-01-01T12:00:00Z" },
      metric: "cpu",
      type: "gauge",
      aggregation: "avg",
    };
    expect(MetricSeriesInputSchema.safeParse(input).success).toBe(false);
    expect(
      MetricSeriesInputSchema.safeParse({
        ...input,
        timeRange: { from: input.timeRange.to, to: input.timeRange.from },
      }).success,
    ).toBe(true);
  });
});
