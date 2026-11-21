import { describe, expect, it, vi } from "vite-plus/test";
import { metricExemplarsOptions, metricKindOptions, metricSeriesOptions } from "./options";
import type { MetricsRepositoryLike } from "./repository";
import type { MetricSeriesInput } from "./schemas";
import { chartClock } from "./step";

describe("metricSeriesOptions", () => {
  const timeRange = { from: "now-1h", to: "now" };
  // A clock from an hour ago ends at its bucket's end, whenever the test reads it.
  const clock = chartClock(timeRange, Date.now() - 60 * 60 * 1000, 0);

  it("marks a step set by the metric's export interval", async () => {
    const repo = { series: async () => ({}) } as unknown as MetricsRepositoryLike;
    const coarse = chartClock(timeRange, Date.now(), 0, 900);
    const input = { timeRange, metric: "a", type: "sum" as const, aggregation: "rate" as const };

    const result = await (
      metricSeriesOptions(repo, input, coarse).queryFn as () => Promise<unknown>
    )();

    expect(result).toMatchObject({ stepFromExport: true });
  });

  it("reads exemplars over the same window and step as the chart", async () => {
    const read = ({ timeRange, step }: MetricSeriesInput) => ({ timeRange, step });
    const series = vi.fn(async (input: MetricSeriesInput) => read(input));
    const exemplars = vi.fn(async (input: MetricSeriesInput) => [read(input)]);
    const repo = { series, exemplars } as unknown as MetricsRepositoryLike;
    const input = { timeRange, metric: "a", type: "histogram" as const };

    const charted = await (
      metricSeriesOptions(repo, { ...input, aggregation: "p95" }, clock)
        .queryFn as () => Promise<unknown>
    )();
    const [sampled] = (await (
      metricExemplarsOptions(repo, input, clock).queryFn as () => Promise<unknown[]>
    )()) as unknown[];

    expect(sampled).toEqual(charted);
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
