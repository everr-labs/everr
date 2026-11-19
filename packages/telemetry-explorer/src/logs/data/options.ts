import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import { utcOffsetMinutesAt } from "@everr/ui/lib/bucket";
import { toAbsoluteTimeRange } from "@everr/ui/lib/time-range";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type {
  LogHistogramInput,
  LogIdentity,
  LogsExplorerInput,
  LogsTotalsInput,
} from "../schemas";
import type { LogsRepositoryLike } from "./repository";

export type LogsExplorerInfiniteInput = Omit<LogsExplorerInput, "offset">;

export function logsExplorerInfiniteOptions(
  repo: LogsRepositoryLike,
  input: LogsExplorerInfiniteInput,
  refresh = "",
) {
  return infiniteQueryOptions({
    queryKey: ["logs", "explorer", "infinite", input] as const,
    queryFn: ({ pageParam }: { pageParam: number }) =>
      repo.explorer({
        ...input,
        timeRange: toAbsoluteTimeRange(input.timeRange),
        offset: pageParam,
      }),
    initialPageParam: 0,
    refetchInterval: getRefreshIntervalMs(refresh) ?? false,
    getNextPageParam: (
      lastPage: { logs: unknown[] } | undefined,
      allPages: { logs: unknown[] }[],
    ) => {
      if (!lastPage) return undefined;
      if (lastPage.logs.length < input.limit) return undefined;
      return allPages.reduce((count, page) => count + page.logs.length, 0);
    },
  });
}

export function logsTotalsOptions(repo: LogsRepositoryLike, input: LogsTotalsInput, refresh = "") {
  return queryOptions({
    queryKey: ["logs", "totals", input],
    refetchInterval: getRefreshIntervalMs(refresh) ?? false,
    queryFn: () => repo.totals({ ...input, timeRange: toAbsoluteTimeRange(input.timeRange) }),
  });
}

export function logDetailOptions(repo: LogsRepositoryLike, identity: LogIdentity) {
  return queryOptions({
    queryKey: ["logs", "detail", identity],
    queryFn: () => repo.detail(identity),
  });
}

export function logsHistogramOptions(
  repo: LogsRepositoryLike,
  input: Omit<LogHistogramInput, "utcOffsetMinutes">,
  refresh = "",
) {
  return queryOptions({
    queryKey: ["logs", "histogram", input],
    refetchInterval: getRefreshIntervalMs(refresh) ?? false,
    queryFn: () => {
      const timeRange = toAbsoluteTimeRange(input.timeRange);
      return repo.histogram({
        ...input,
        timeRange,
        utcOffsetMinutes: utcOffsetMinutesAt(new Date(timeRange.to)),
      });
    },
  });
}
