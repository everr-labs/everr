import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import { resolveTimeRange, type TimeRange, toClickHouseDateTime } from "@everr/ui/lib/time-range";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { PAGE_SIZE, type RecordingsRepositoryLike } from "./schemas";

export type RecordingsQueryInput = {
  timeRange: TimeRange;
  refresh: string;
  service: string[];
  environment: string[];
};

function windowOf(timeRange: TimeRange) {
  const { fromDate, toDate } = resolveTimeRange(timeRange);
  return {
    fromTs: toClickHouseDateTime(fromDate),
    toTs: toClickHouseDateTime(toDate),
  };
}

export function recordingsInfiniteOptions(
  repo: RecordingsRepositoryLike,
  input: RecordingsQueryInput,
) {
  const refreshMs = getRefreshIntervalMs(input.refresh);
  return infiniteQueryOptions({
    queryKey: [
      "recordings",
      "list",
      {
        timeRange: input.timeRange,
        service: input.service,
        environment: input.environment,
      },
    ] as const,
    queryFn: ({ pageParam }: { pageParam: number }) =>
      repo.list({
        ...windowOf(input.timeRange),
        service: input.service,
        environment: input.environment,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return allPages.reduce((count, page) => count + page.length, 0);
    },
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}

export function recordingOptions(
  repo: RecordingsRepositoryLike,
  input: RecordingsQueryInput & { clipId: string },
) {
  const refreshMs = getRefreshIntervalMs(input.refresh);
  return queryOptions({
    queryKey: [
      "recordings",
      "clip",
      input.clipId,
      input.timeRange,
      input.service,
      input.environment,
    ] as const,
    queryFn: () =>
      repo.get({
        clipId: input.clipId,
        ...windowOf(input.timeRange),
        service: input.service,
        environment: input.environment,
      }),
    enabled: input.clipId.length > 0,
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}
