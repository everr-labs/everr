import { inViewerTimeRange, type TimeRange, toClickHouseDateTime } from "@everr/ui/lib/time-range";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { AttributeFilter } from "../../attribute-filter/schemas";
import type { ErrorsRepositoryLike } from "./repository";
import type { ErrorIssueDetail, ErrorIssuesResult, ErrorSort } from "./types";

export type ErrorIssuesInfiniteInput = {
  timeRange: TimeRange;
  q: string;
  service: string[];
  fingerprint: string;
  sort: ErrorSort;
  limit: number;
  attributes: AttributeFilter[];
  withRecording: boolean;
};

export function errorIssuesInfiniteOptions(
  repo: ErrorsRepositoryLike,
  input: ErrorIssuesInfiniteInput,
) {
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
        withRecording: input.withRecording,
      },
    ] as const,
    queryFn: ({ pageParam }: { pageParam: number }) =>
      inViewerTimeRange(input.timeRange, { issues: [] }, (timeRange) =>
        repo.searchIssues({
          fromTs: toClickHouseDateTime(new Date(timeRange.from)),
          toTs: toClickHouseDateTime(new Date(timeRange.to)),
          q: input.q,
          service: input.service,
          fingerprint: input.fingerprint,
          sort: input.sort,
          limit: input.limit,
          offset: pageParam,
          attributes: input.attributes,
          withRecording: input.withRecording,
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (
      lastPage: ErrorIssuesResult | undefined,
      allPages: (ErrorIssuesResult | undefined)[],
    ) => {
      if (!lastPage) return undefined;
      if (lastPage.issues.length < input.limit) return undefined;
      return allPages.reduce((count, page) => count + (page?.issues.length ?? 0), 0);
    },
  });
}

export type ErrorIssueOptionsInput = {
  fingerprint: string;
  timeRange: TimeRange;
  service: string[];
  withRecording: boolean;
  occurrenceLimit: number;
};

export function errorIssueOptions(repo: ErrorsRepositoryLike, input: ErrorIssueOptionsInput) {
  return queryOptions({
    queryKey: [
      "errors",
      "issue",
      input.fingerprint,
      input.timeRange,
      input.service,
      input.withRecording,
      input.occurrenceLimit,
    ] as const,
    // Nothing happened in a range that holds no time, so there's no issue to show.
    queryFn: () =>
      inViewerTimeRange<ErrorIssueDetail | null>(input.timeRange, null, (timeRange) =>
        repo.getIssue({
          fingerprint: input.fingerprint,
          fromTs: toClickHouseDateTime(new Date(timeRange.from)),
          toTs: toClickHouseDateTime(new Date(timeRange.to)),
          service: input.service,
          withRecording: input.withRecording,
          occurrenceLimit: input.occurrenceLimit,
        }),
      ),
    enabled: input.fingerprint.length > 0,
  });
}

export function errorServicesOptions(
  repo: ErrorsRepositoryLike,
  input: {
    timeRange: TimeRange;
    attributes: AttributeFilter[];
  },
) {
  return queryOptions({
    queryKey: ["errors", "services", input.timeRange, input.attributes] as const,
    queryFn: () =>
      inViewerTimeRange(input.timeRange, [], (timeRange) =>
        repo.listServices({
          fromTs: toClickHouseDateTime(new Date(timeRange.from)),
          toTs: toClickHouseDateTime(new Date(timeRange.to)),
          attributes: input.attributes,
        }),
      ),
  });
}
