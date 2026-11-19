import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vite-plus/test";
import { logsExplorerInfiniteOptions, logsHistogramOptions, logsTotalsOptions } from "./options";
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

it("keeps refresh off and uses the selected cadence instead of a global polling default", async () => {
  vi.useFakeTimers();
  const totals = vi.fn().mockResolvedValue({ totalCount: 0, levelCounts: [] });
  const client = new QueryClient({
    defaultOptions: { queries: { refetchInterval: 10_000, retry: false } },
  });
  const repository = { ...repo, totals };
  const observer = new QueryObserver(client, logsTotalsOptions(repository, input, "off"));
  const unsubscribe = observer.subscribe(() => {});
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(totals).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(totals).toHaveBeenCalledTimes(1);
    observer.setOptions(logsTotalsOptions(repository, input, "1m"));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(totals).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(totals).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
    client.clear();
    vi.useRealTimers();
  }
});

describe("logsHistogramOptions", () => {
  it("queries Today as the viewer's day, keyed by the relative range", async () => {
    vi.stubEnv("TZ", "America/New_York");
    vi.useFakeTimers({ now: new Date("2026-11-19T15:00:00Z") });
    const histogram = vi.fn().mockResolvedValue([]);
    const today = { ...input, timeRange: { from: "now/d", to: "now/d" }, histogramBuckets: 80 };
    try {
      const options = logsHistogramOptions({ ...repo, histogram }, today);
      await new QueryClient().fetchQuery(options);

      expect(options.queryKey).toEqual(["logs", "histogram", today]);
      expect(histogram).toHaveBeenCalledWith(
        expect.objectContaining({
          timeRange: { from: "2026-11-19T05:00:00.000Z", to: "2026-11-20T04:59:59.999Z" },
          utcOffsetMinutes: -300,
        }),
      );
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
});
