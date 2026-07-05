import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import { resolveTimeRange, type TimeRange, toClickHouseDateTime } from "@everr/ui/lib/time-range";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { AttributeFilter } from "../../attribute-filter/schemas";
import type { ErrorsRepositoryLike } from "./repository";
import type { ErrorIssuesResult, ErrorSort } from "./types";

export type ErrorIssuesInfiniteInput = {
  timeRange: TimeRange;
  refresh: string;
  q: string;
  service: string[];
  fingerprint: string;
  sort: ErrorSort;
  limit: number;
  attributes: AttributeFilter[];
};

export function errorIssuesInfiniteOptions(
  repo: ErrorsRepositoryLike,
  input: ErrorIssuesInfiniteInput,
) {
  const refreshMs = getRefreshIntervalMs(input.refresh);
  return infiniteQueryOptions({
    queryKey: [
      "errors",
      "issues",
      "infinite",
      {
        timeRange: input.timeRange,
        q: input.q,
        service: input.service,
        fingerprint: input.fingerprint,
        sort: input.sort,
        limit: input.limit,
        attributes: input.attributes,
      },
    ] as const,
    queryFn: ({ pageParam }: { pageParam: number }) => {
      const { fromDate, toDate } = resolveTimeRange(input.timeRange);
      return repo.searchIssues({
        fromTs: toClickHouseDateTime(fromDate),
        toTs: toClickHouseDateTime(toDate),
        q: input.q,
        service: input.service,
        fingerprint: input.fingerprint,
        sort: input.sort,
        limit: input.limit,
        offset: pageParam,
        attributes: input.attributes,
      });
    },
    initialPageParam: 0,
    getNextPageParam: (
      lastPage: ErrorIssuesResult | undefined,
      allPages: (ErrorIssuesResult | undefined)[],
    ) => {
      if (!lastPage) return undefined;
      if (lastPage.issues.length < input.limit) return undefined;
      return allPages.reduce((count, page) => count + (page?.issues.length ?? 0), 0);
    },
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}

export type ErrorIssueOptionsInput = {
  fingerprint: string;
  timeRange: TimeRange;
  refresh: string;
  service: string[];
  occurrenceLimit: number;
};

export function errorIssueOptions(repo: ErrorsRepositoryLike, input: ErrorIssueOptionsInput) {
  const refreshMs = getRefreshIntervalMs(input.refresh);
  return queryOptions({
    queryKey: [
      "errors",
      "issue",
      input.fingerprint,
      input.timeRange,
      input.service,
      input.occurrenceLimit,
    ] as const,
    queryFn: () => {
      const { fromDate, toDate } = resolveTimeRange(input.timeRange);
      return repo.getIssue({
        fingerprint: input.fingerprint,
        fromTs: toClickHouseDateTime(fromDate),
        toTs: toClickHouseDateTime(toDate),
        service: input.service,
        occurrenceLimit: input.occurrenceLimit,
      });
    },
    enabled: input.fingerprint.length > 0,
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}

export function errorServicesOptions(
  repo: ErrorsRepositoryLike,
  input: {
    timeRange: TimeRange;
    refresh: string;
    attributes: AttributeFilter[];
  },
) {
  const refreshMs = getRefreshIntervalMs(input.refresh);
  return queryOptions({
    queryKey: ["errors", "services", input.timeRange, input.attributes] as const,
    queryFn: () => {
      const { fromDate, toDate } = resolveTimeRange(input.timeRange);
      return repo.listServices({
        fromTs: toClickHouseDateTime(fromDate),
        toTs: toClickHouseDateTime(toDate),
        attributes: input.attributes,
      });
    },
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}
