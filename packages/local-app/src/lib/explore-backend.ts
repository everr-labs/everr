import type { ExploreBackend } from "@everr/telemetry-explorer/explore/routes";
import { ErrorsRepository } from "@everr/telemetry-explorer/errors";
import { LogsRepository } from "@everr/telemetry-explorer/logs";
import { MetricsRepository } from "@everr/telemetry-explorer/metrics";
import { ProfilesRepository, RuntimeMetricsRepository } from "@everr/telemetry-explorer/profiles";
import { getTraceOptions, TracesRepository } from "@everr/telemetry-explorer/traces";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { LocalTelemetryGate } from "@/features/local-telemetry/collector-status";
import { localSqlClient } from "@/features/logs/local-sql-client";

const tracesRepo = new TracesRepository(localSqlClient);

function useLocalErrorTraceSpans(traceId: string, enabled: boolean) {
  const traceQuery = useQuery({
    ...getTraceOptions({ repo: tracesRepo, traceId }),
    enabled,
    // Occurrences of one error tend to share a shape, so the list changes in
    // place instead of collapsing and regrowing.
    placeholderData: keepPreviousData,
  });
  return {
    spans: (traceQuery.data ?? []).map((span) => ({
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.spanName,
      durationMs: Number(span.duration) / 1_000_000,
      conclusion: span.statusCode,
      jobName: undefined,
    })),
    isPending: traceQuery.isPending,
    isError: traceQuery.isError,
    isStale: traceQuery.isPlaceholderData,
    refetch: () => void traceQuery.refetch(),
  };
}

export const localExploreBackend: ExploreBackend = {
  repos: {
    logs: new LogsRepository(localSqlClient),
    traces: tracesRepo,
    metrics: new MetricsRepository(localSqlClient),
    errors: new ErrorsRepository(localSqlClient),
    profiles: new ProfilesRepository(localSqlClient),
    runtimeMetrics: new RuntimeMetricsRepository(localSqlClient),
  },
  Gate: LocalTelemetryGate,
  useErrorTraceSpans: useLocalErrorTraceSpans,
};
