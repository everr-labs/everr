import type { ExploreBackend } from "@everr/app-shell/explore/routes";
import { ErrorsRepository } from "@everr/telemetry-explorer/errors";
import { LogsRepository } from "@everr/telemetry-explorer/logs";
import { MetricsRepository } from "@everr/telemetry-explorer/metrics";
import { getTraceOptions, TracesRepository } from "@everr/telemetry-explorer/traces";
import { useQuery } from "@tanstack/react-query";
import { LocalTelemetryGate } from "@/features/local-telemetry/collector-status";
import { localSqlClient } from "@/features/logs/local-sql-client";

const tracesRepo = new TracesRepository(localSqlClient);

/** The error trace panel draws the spans of the trace the occurrence belongs to. */
function useLocalErrorTraceSpans(traceId: string, enabled: boolean) {
  const traceQuery = useQuery({ ...getTraceOptions({ repo: tracesRepo, traceId }), enabled });
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
    refetch: () => void traceQuery.refetch(),
  };
}

/** What the Explore pages of `@everr/app-shell` read in the local app. */
export const localExploreBackend: ExploreBackend = {
  repos: {
    logs: new LogsRepository(localSqlClient),
    traces: tracesRepo,
    metrics: new MetricsRepository(localSqlClient),
    errors: new ErrorsRepository(localSqlClient),
  },
  Gate: LocalTelemetryGate,
  useErrorTraceSpans: useLocalErrorTraceSpans,
};
