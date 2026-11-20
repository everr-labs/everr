import { describe, expect, it, vi } from "vite-plus/test";
import { metricExemplarsOptions, metricKindOptions, metricSeriesOptions } from "./options";
import type { MetricsRepositoryLike } from "./repository";
import type { MetricSeriesInput } from "./schemas";

describe("metricSeriesOptions", () => {
  it("fetches every query over the same absolute range", async () => {
    const series = vi.fn(async (input: MetricSeriesInput) => input.timeRange);
    const repo = { series } as unknown as MetricsRepositoryLike;
    const query = (metric: string): MetricSeriesInput => ({
      timeRange: { from: "now-1h", to: "now" },
      metric,
      type: "gauge",
      aggregation: "avg",
    });
    const { queryFn } = metricSeriesOptions(repo, [query("a"), null, query("b")]);

    const [a, skipped, b] = (await (queryFn as () => Promise<unknown[]>)()) as {
      from: string;
      to: string;
    }[];

    expect(skipped).toBeNull();
    expect(a).toEqual(b);
    expect(Date.parse(a!.to) - Date.parse(a!.from)).toBe(60 * 60 * 1000);
  });

  it("resolves the range as the chart does for the page's other queries", async () => {
    const timeRange = { from: "now/d", to: "now/d" };
    const series = vi.fn(async (input: MetricSeriesInput) => input.timeRange);
    const exemplars = vi.fn(async (input: MetricSeriesInput) => [input.timeRange]);
    const repo = { series, exemplars } as unknown as MetricsRepositoryLike;
    const input = { timeRange, metric: "a", type: "histogram" as const };

    const [charted] = (await (
      metricSeriesOptions(repo, [{ ...input, aggregation: "p95" }]).queryFn as () => Promise<
        unknown[]
      >
    )()) as unknown[];
    const [sampled] = (await (
      metricExemplarsOptions(repo, input).queryFn as () => Promise<unknown[]>
    )()) as unknown[];

    expect(sampled).toEqual(charted);
  });
});

describe("a range that ends before it starts", () => {
  it("charts nothing without asking the server", async () => {
    vi.stubEnv("TZ", "UTC");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T02:00:00Z"));
    try {
      const series = vi.fn();
      const repo = { series } as unknown as MetricsRepositoryLike;
      const input: MetricSeriesInput = {
        // Today until five hours ago: nothing before 05:00.
        timeRange: { from: "now/d", to: "now-5h" },
        metric: "a",
        type: "gauge",
        aggregation: "avg",
      };
      const [result] = (await (
        metricSeriesOptions(repo, [input]).queryFn as () => Promise<unknown[]>
      )()) as { series: unknown[] }[];

      expect(result?.series).toEqual([]);
      expect(series).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
});

describe("metricKindOptions", () => {
  it("keeps a selected kind listed when no metric in range has it", () => {
    const { select } = metricKindOptions(
      {} as MetricsRepositoryLike,
      { timeRange: { from: "now-1h", to: "now" } },
      ["summary"],
    );
    expect(select(["gauge"])).toEqual(["gauge", "summary"]);
  });
});
