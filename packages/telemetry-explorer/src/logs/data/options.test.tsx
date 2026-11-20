import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { logsExplorerInfiniteOptions, logsHistogramOptions } from "./options";
import type { LogsRepositoryLike } from "./repository";

const repo: LogsRepositoryLike = {
  explorer: vi.fn(),
  totals: vi.fn(),
  histogram: vi.fn(),
  detail: vi.fn(),
  filterOptions: vi.fn(),
  attributeKeys: vi.fn(),
  attributeValues: vi.fn(),
};

const input = {
  timeRange: { from: "now-1h", to: "now" },
  levels: [],
  services: [],
  attributes: [],
  limit: 100,
};

describe("logsExplorerInfiniteOptions", () => {
  it("does not request another page when the last page is missing", () => {
    const options = logsExplorerInfiniteOptions(repo, input);
    const getNextPageParam = options.getNextPageParam as (
      lastPage: { logs: unknown[] } | undefined,
      allPages: { logs: unknown[] }[],
    ) => unknown;

    expect(getNextPageParam(undefined, [])).toBeUndefined();
  });
});

describe("logsHistogramOptions", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("queries Today as the viewer's day, keyed by the relative range", async () => {
    vi.stubEnv("TZ", "America/New_York");
    vi.useFakeTimers({ now: new Date("2026-11-19T15:00:00Z") });
    const histogram = vi.fn().mockResolvedValue([]);
    const today = { ...input, timeRange: { from: "now/d", to: "now/d" }, histogramBuckets: 80 };
    const options = logsHistogramOptions({ ...repo, histogram }, today);
    await new QueryClient().fetchQuery(options);

    expect(options.queryKey).toEqual(["logs", "histogram", today]);
    expect(histogram).toHaveBeenCalledWith(
      expect.objectContaining({
        timeRange: { from: "2026-11-19T05:00:00.000Z", to: "2026-11-20T04:59:59.999Z" },
        utcOffsetMinutes: -300,
      }),
    );
  });
});
