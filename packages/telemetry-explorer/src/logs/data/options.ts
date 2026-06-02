import type { TimeRange } from "@everr/ui/lib/time-range";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type {
  LogFilterOptions,
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
) {
  return infiniteQueryOptions({
    queryKey: ["logs", "explorer", "infinite", input] as const,
    queryFn: ({ pageParam }: { pageParam: number }) =>
      repo.explorer({ ...input, offset: pageParam }),
    initialPageParam: 0,
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

export function logsTotalsOptions(
  repo: LogsRepositoryLike,
  input: LogsTotalsInput,
) {
  return queryOptions({
    queryKey: ["logs", "totals", input],
    queryFn: () => repo.totals(input),
  });
}

export function logDetailOptions(
  repo: LogsRepositoryLike,
  identity: LogIdentity,
) {
  return queryOptions({
    queryKey: ["logs", "detail", identity],
    queryFn: () => repo.detail(identity),
  });
}

export function logsHistogramOptions(
  repo: LogsRepositoryLike,
  input: LogHistogramInput,
) {
  return queryOptions({
    queryKey: ["logs", "histogram", input],
    queryFn: () => repo.histogram(input),
  });
}

export function logServiceFilterOptions(
  repo: LogsRepositoryLike,
  input: { timeRange: TimeRange },
) {
  return {
    queryKey: ["logs", "filterOptions", input.timeRange] as const,
    queryFn: () => repo.filterOptions(input),
    select: (data: LogFilterOptions) => data.services,
  };
}
