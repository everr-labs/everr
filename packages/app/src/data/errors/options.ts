import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import {
  resolveTimeRange,
  type TimeRange,
  toClickHouseDateTime,
} from "@everr/ui/lib/time-range";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type {
  GetErrorIssueInput,
  ListErrorServicesInput,
  SearchErrorIssuesInput,
} from "./schemas";
import type { ErrorIssuesResult, ErrorSort } from "./types";

type ServerFn<TInput, TResult> = (args: { data: TInput }) => Promise<TResult>;

export type ErrorIssuesInfiniteOptionsInput = {
  searchErrorIssues: ServerFn<SearchErrorIssuesInput, ErrorIssuesResult>;
  timeRange: TimeRange;
  refresh: string;
  q: string;
  service: string[];
  fingerprint: string;
  sort: ErrorSort;
  limit: number;
};

export function errorIssuesInfiniteOptions(
  input: ErrorIssuesInfiniteOptionsInput,
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
      },
    ] as const,
    queryFn: ({ pageParam }: { pageParam: number }) => {
      const { fromDate, toDate } = resolveTimeRange(input.timeRange);
      return input.searchErrorIssues({
        data: {
          fromTs: toClickHouseDateTime(fromDate),
          toTs: toClickHouseDateTime(toDate),
          q: input.q,
          service: input.service,
          fingerprint: input.fingerprint,
          sort: input.sort,
          limit: input.limit,
          offset: pageParam,
        },
      });
    },
    initialPageParam: 0,
    getNextPageParam: (
      lastPage: ErrorIssuesResult,
      allPages: ErrorIssuesResult[],
    ) => {
      if (lastPage.issues.length < input.limit) return undefined;
      return allPages.reduce((count, page) => count + page.issues.length, 0);
    },
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}

export type ErrorIssueOptionsInput<TResult> = {
  getErrorIssue: ServerFn<GetErrorIssueInput, TResult>;
  fingerprint: string;
  timeRange: TimeRange;
  refresh: string;
  service: string[];
  occurrenceLimit: number;
};

export function errorIssueOptions<TResult>(
  input: ErrorIssueOptionsInput<TResult>,
) {
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
    queryFn: async () => {
      const { fromDate, toDate } = resolveTimeRange(input.timeRange);
      return input.getErrorIssue({
        data: {
          fingerprint: input.fingerprint,
          fromTs: toClickHouseDateTime(fromDate),
          toTs: toClickHouseDateTime(toDate),
          service: input.service,
          occurrenceLimit: input.occurrenceLimit,
        },
      });
    },
    enabled: input.fingerprint.length > 0,
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}

export function errorServicesOptions<TResult>(input: {
  listErrorServices: ServerFn<ListErrorServicesInput, TResult>;
  timeRange: TimeRange;
  refresh: string;
}) {
  const refreshMs = getRefreshIntervalMs(input.refresh);
  return queryOptions({
    queryKey: ["errors", "services", input.timeRange] as const,
    queryFn: async () => {
      const { fromDate, toDate } = resolveTimeRange(input.timeRange);
      return input.listErrorServices({
        data: {
          fromTs: toClickHouseDateTime(fromDate),
          toTs: toClickHouseDateTime(toDate),
        },
      });
    },
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}
