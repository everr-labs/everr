import { queryOptions } from "@tanstack/react-query";
import {
  getRefreshIntervalMs,
  resolveTimeRange,
  type TimeRange,
  toClickHouseDateTime,
} from "@/lib/time-range";
import type { SpanStatusFilter } from "./schemas";
import { getTrace, listServiceIdentities, searchTraces } from "./server";
import type { DetailWindow } from "./window";

export type TraceSearchOptionsInput = {
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
  const { refresh, ...key } = input;
  const refreshMs = getRefreshIntervalMs(refresh);
  return queryOptions({
    queryKey: ["traces", "search", key] as const,
    queryFn: async () => {
      const { fromDate, toDate } = resolveTimeRange(input.timeRange);
      return searchTraces({
        data: {
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
        },
      });
    },
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}

export type GetTraceOptionsInput = {
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
      getTrace({
        data: {
          traceId: input.traceId,
          fromTs: input.window.fromTs,
          toTs: input.window.toTs,
        },
      }),
    enabled: input.traceId.length > 0,
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}

export function listServiceIdentitiesOptions(
  timeRange: TimeRange,
  refresh: string,
) {
  const refreshMs = getRefreshIntervalMs(refresh);
  return queryOptions({
    queryKey: ["traces", "service-identities", timeRange] as const,
    queryFn: async () => {
      const { fromDate, toDate } = resolveTimeRange(timeRange);
      return listServiceIdentities({
        data: {
          fromTs: toClickHouseDateTime(fromDate),
          toTs: toClickHouseDateTime(toDate),
        },
      });
    },
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}
