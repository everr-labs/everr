import { queryOptions } from "@tanstack/react-query";
import {
  getRefreshIntervalMs,
  resolveTimeRange,
  type TimeRange,
  toClickHouseDateTime,
} from "../time-range";
import type { TracesRepositoryLike } from "./repository";
import type { SpanStatusFilter } from "./schemas";
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

const MS_TO_NS = 1_000_000n;

export function tracesSearchOptions(input: TraceSearchOptionsInput) {
  const { repo, refresh, ...key } = input;
  const refreshMs = getRefreshIntervalMs(refresh);
  const queryKey = ["traces", "search", key] as const;
  return queryOptions({
    queryKey,
    queryFn: async () => {
      const { fromDate, toDate } = resolveTimeRange(input.timeRange);
      return repo.search({
        fromTs: toClickHouseDateTime(fromDate),
        toTs: toClickHouseDateTime(toDate),
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
    placeholderData: (previousData, previousQuery) =>
      shouldKeepPreviousSearchRows(queryKey, previousQuery?.queryKey)
        ? previousData
        : undefined,
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}

type TraceSearchKey = Omit<TraceSearchOptionsInput, "repo" | "refresh">;
type TraceSearchQueryKey = readonly ["traces", "search", TraceSearchKey];

function shouldKeepPreviousSearchRows(
  current: TraceSearchQueryKey,
  previous: readonly unknown[] | undefined,
): boolean {
  if (!isTraceSearchQueryKey(previous)) return false;
  const currentKey = current[2];
  const previousKey = previous[2];
  return (
    currentKey.limit > previousKey.limit &&
    currentKey.timeRange.from === previousKey.timeRange.from &&
    currentKey.timeRange.to === previousKey.timeRange.to &&
    arraysEqual(currentKey.namespace, previousKey.namespace) &&
    arraysEqual(currentKey.service, previousKey.service) &&
    currentKey.name === previousKey.name &&
    currentKey.minMs === previousKey.minMs &&
    currentKey.maxMs === previousKey.maxMs &&
    currentKey.status === previousKey.status
  );
}

function isTraceSearchQueryKey(
  key: readonly unknown[] | undefined,
): key is TraceSearchQueryKey {
  return key?.[0] === "traces" && key[1] === "search" && isSearchKey(key[2]);
}

function isSearchKey(value: unknown): value is TraceSearchKey {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TraceSearchKey>;
  return (
    typeof candidate.timeRange?.from === "string" &&
    typeof candidate.timeRange.to === "string" &&
    Array.isArray(candidate.namespace) &&
    Array.isArray(candidate.service) &&
    typeof candidate.name === "string" &&
    typeof candidate.limit === "number"
  );
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
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
