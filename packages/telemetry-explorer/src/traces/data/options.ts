import { inViewerTimeRange, type TimeRange, toClickHouseDateTime } from "@everr/ui/lib/time-range";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { AttributeFilter } from "../../attribute-filter/schemas";
import type { TracesRepositoryLike } from "./repository";
import type { SpanStatusFilter } from "./schemas";
import type { ServiceIdentity, TraceSummary } from "./types";

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

/** The read itself, outside `queryOptions`, whose result types `queryFn` as
 *  optional: the namespace filter's options need it required. */
function serviceIdentitiesQuery(repo: TracesRepositoryLike, input: { timeRange: TimeRange }) {
  return {
    queryKey: ["traces", "service-identities", input.timeRange] as const,
    queryFn: () =>
      inViewerTimeRange(input.timeRange, [], (timeRange) =>
        repo.listServiceIdentities({
          fromTs: toClickHouseDateTime(new Date(timeRange.from)),
          toTs: toClickHouseDateTime(new Date(timeRange.to)),
        }),
      ),
  };
}

export function listServiceIdentitiesOptions(
  repo: TracesRepositoryLike,
  input: { timeRange: TimeRange },
) {
  return queryOptions(serviceIdentitiesQuery(repo, input));
}

/** The namespace filter's options: the same read (and cache entry) as
 *  `listServiceIdentitiesOptions`, so the picker shows "Loading…" while the
 *  page's identities load instead of an empty list. */
export function serviceNamespaceFilterOptions(
  repo: TracesRepositoryLike,
  input: { timeRange: TimeRange },
) {
  return {
    ...serviceIdentitiesQuery(repo, input),
    select: namespacesOf,
  };
}

/** Module-level, so its identity is stable: Query reruns a `select` whose
 *  identity changes, on every render of the picker. */
function namespacesOf(rows: ServiceIdentity[]) {
  return Array.from(
    new Set(rows.map((row) => row.serviceNamespace).filter((namespace) => namespace.length > 0)),
  ).sort();
}
