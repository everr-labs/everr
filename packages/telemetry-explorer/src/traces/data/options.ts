import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import {
  resolveTimeRange,
  type TimeRange,
  toClickHouseDateTime,
} from "@everr/ui/lib/time-range";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { TracesRepositoryLike } from "./repository";
import type { SpanStatusFilter } from "./schemas";
import type { TraceSummary } from "./types";
import type { DetailWindow } from "./window";

export type TraceSearchOptionsInput = {
  repo: TracesRepositoryLike;
  timeRange: TimeRange;
  refresh: string;
  namespace: string[];
  service: string[];
  name: string;
  minMs: number | undefined;
  maxMs: number | undefined;
  status: SpanStatusFilter;
  limit: number;
};

type TraceSearchCursor = {
  startTs: string;
  traceId: string;
};

const MS_TO_NS = 1_000_000n;

export function tracesSearchInfiniteOptions(input: TraceSearchOptionsInput) {
  const { repo, refresh, ...key } = input;
  const refreshMs = getRefreshIntervalMs(refresh);
  const queryKey = ["traces", "search", "infinite", key] as const;
  return infiniteQueryOptions({
    queryKey,
    queryFn: async ({ pageParam }: { pageParam: TraceSearchCursor | null }) => {
      const { fromDate, toDate } = resolveTimeRange(input.timeRange);
      return repo.search({
        fromTs: toClickHouseDateTime(fromDate),
        toTs: toClickHouseDateTime(toDate),
        cursorStartTs: pageParam?.startTs,
        cursorTraceId: pageParam?.traceId,
        namespace: input.namespace,
        service: input.service,
        name: input.name,
        minDurationNs:
          input.minMs === undefined
            ? undefined
            : (BigInt(input.minMs) * MS_TO_NS).toString(),
        maxDurationNs:
          input.maxMs === undefined
            ? undefined
            : (BigInt(input.maxMs) * MS_TO_NS).toString(),
        status: input.status,
        limit: input.limit,
      });
    },
    initialPageParam: null,
    getNextPageParam: (lastPage: TraceSummary[] | undefined) => {
      if (!lastPage || lastPage.length < input.limit) return undefined;
      const lastRow = lastPage[lastPage.length - 1];
      if (!lastRow) return undefined;
      return { startTs: lastRow.startTs, traceId: lastRow.traceId };
    },
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}

export type GetTraceOptionsInput = {
  repo: TracesRepositoryLike;
  traceId: string;
  window: DetailWindow;
  refresh: string;
};

export function getTraceOptions(input: GetTraceOptionsInput) {
  const refreshMs = getRefreshIntervalMs(input.refresh);
  return queryOptions({
    queryKey: [
      "traces",
      "get",
      input.traceId,
      input.window.fromTs,
      input.window.toTs,
    ] as const,
    queryFn: () =>
      input.repo.getTrace({
        traceId: input.traceId,
        fromTs: input.window.fromTs,
        toTs: input.window.toTs,
      }),
    enabled: input.traceId.length > 0,
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}

export function listServiceIdentitiesOptions(
  repo: TracesRepositoryLike,
  input: { timeRange: TimeRange; refresh: string },
) {
  const refreshMs = getRefreshIntervalMs(input.refresh);
  return queryOptions({
    queryKey: ["traces", "service-identities", input.timeRange] as const,
    queryFn: async () => {
      const { fromDate, toDate } = resolveTimeRange(input.timeRange);
      return repo.listServiceIdentities({
        fromTs: toClickHouseDateTime(fromDate),
        toTs: toClickHouseDateTime(toDate),
      });
    },
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}
