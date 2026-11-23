import { dataInfiniteQueryOptions, dataQueryOptions } from "@everr/ui/lib/query-options";
import { inViewerTimeRange, viewerBucketWindow } from "@everr/ui/lib/time-range";
import type {
  LogHistogramInput,
  LogIdentity,
  LogsExplorerInput,
  LogsTotalsInput,
  LogsTotalsResult,
} from "../schemas";
import type { LogsRepositoryLike } from "./repository";

const NO_LOGS_TOTALS: LogsTotalsResult = {
  totalCount: 0,
  levelCounts: { error: 0, warning: 0, info: 0, debug: 0, trace: 0, unknown: 0 },
};

export type LogsExplorerInfiniteInput = Omit<LogsExplorerInput, "offset">;

export function logsExplorerInfiniteOptions(
  repo: LogsRepositoryLike,
  input: LogsExplorerInfiniteInput,
) {
  return dataInfiniteQueryOptions({
    queryKey: ["logs", "explorer", "infinite", input] as const,
    queryFn: ({ pageParam }: { pageParam: number }) =>
      inViewerTimeRange(input.timeRange, { logs: [] }, (timeRange) =>
        repo.explorer({ ...input, timeRange, offset: pageParam }),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage) return undefined;
      if (lastPage.logs.length < input.limit) return undefined;
      return allPages.reduce((count, page) => count + page.logs.length, 0);
    },
  });
}

export function logsTotalsOptions(repo: LogsRepositoryLike, input: LogsTotalsInput) {
  return dataQueryOptions({
    queryKey: ["logs", "totals", input],
    queryFn: () =>
      inViewerTimeRange(input.timeRange, NO_LOGS_TOTALS, (timeRange) =>
        repo.totals({ ...input, timeRange }),
      ),
  });
}

export function logDetailOptions(repo: LogsRepositoryLike, identity: LogIdentity) {
  return dataQueryOptions({
    queryKey: ["logs", "detail", identity],
    queryFn: () => repo.detail(identity),
  });
}

export function logsHistogramOptions(
  repo: LogsRepositoryLike,
  input: Omit<LogHistogramInput, "utcOffsetMinutes">,
) {
  return dataQueryOptions({
    queryKey: ["logs", "histogram", input],
    queryFn: () =>
      inViewerTimeRange(input.timeRange, [], () =>
        repo.histogram({ ...input, ...viewerBucketWindow(input.timeRange) }),
      ),
  });
}
