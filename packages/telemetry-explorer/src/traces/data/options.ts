import { inViewerTimeRange, type TimeRange, toClickHouseDateTime } from "@everr/ui/lib/time-range";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { AttributeFilter } from "../../attribute-filter/schemas";
import type { TracesRepositoryLike } from "./repository";
import type { SpanStatusFilter } from "./schemas";
import type { TraceSummary } from "./types";

export type TraceSearchOptionsInput = {
  repo: TracesRepositoryLike;
  timeRange: TimeRange;
  namespace: string[];
  service: string[];
  name: string;
  minMs: number | undefined;
  maxMs: number | undefined;
  status: SpanStatusFilter;
  attributes: AttributeFilter[];
  limit: number;
};

type TraceSearchCursor = {
  startTs: string;
  traceId: string;
};

const MS_TO_NS = 1_000_000n;

export function tracesSearchInfiniteOptions(input: TraceSearchOptionsInput) {
  const { repo, ...key } = input;
  const queryKey = ["traces", "search", "infinite", key] as const;
  // oxlint-disable-next-line query/exhaustive-deps -- DI repo / input already in key; not a real missing dep
  return infiniteQueryOptions({
    queryKey,
    queryFn: ({ pageParam }: { pageParam: TraceSearchCursor | null }) =>
      inViewerTimeRange(input.timeRange, [], (timeRange) =>
        repo.search({
          fromTs: toClickHouseDateTime(new Date(timeRange.from)),
          toTs: toClickHouseDateTime(new Date(timeRange.to)),
          cursorStartTs: pageParam?.startTs,
          cursorTraceId: pageParam?.traceId,
          namespace: input.namespace,
          service: input.service,
          name: input.name,
          minDurationNs:
            input.minMs === undefined ? undefined : (BigInt(input.minMs) * MS_TO_NS).toString(),
          maxDurationNs:
            input.maxMs === undefined ? undefined : (BigInt(input.maxMs) * MS_TO_NS).toString(),
          status: input.status,
          attributes: input.attributes,
          limit: input.limit,
        }),
      ),
    initialPageParam: null,
    getNextPageParam: (lastPage: TraceSummary[] | undefined) => {
      if (!lastPage || lastPage.length < input.limit) return undefined;
      const lastRow = lastPage[lastPage.length - 1];
      if (!lastRow) return undefined;
      return { startTs: lastRow.startTs, traceId: lastRow.traceId };
    },
  });
}

export type GetTraceOptionsInput = {
  repo: TracesRepositoryLike;
  traceId: string;
};

export function getTraceOptions(input: GetTraceOptionsInput) {
  return queryOptions({
    queryKey: ["traces", "get", input.traceId] as const,
    queryFn: () =>
      input.repo.getTrace({
        traceId: input.traceId,
      }),
    enabled: input.traceId.length > 0,
  });
}

export function listServiceIdentitiesOptions(
  repo: TracesRepositoryLike,
  input: { timeRange: TimeRange },
) {
  return queryOptions({
    queryKey: ["traces", "service-identities", input.timeRange] as const,
    queryFn: () =>
      inViewerTimeRange(input.timeRange, [], (timeRange) =>
        repo.listServiceIdentities({
          fromTs: toClickHouseDateTime(new Date(timeRange.from)),
          toTs: toClickHouseDateTime(new Date(timeRange.to)),
        }),
      ),
  });
}
