import type { ExploreBackend } from "@everr/telemetry-explorer/explore/routes";
import { Button } from "@everr/ui/components/button";
import { keepPreviousData, type QueryClient, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileSearch } from "lucide-react";
import { remoteErrorsRepo } from "#app/data/errors/remote-repo.ts";
import { remoteRepo } from "#app/data/logs-explorer/remote-repo.ts";
import { remoteMetricsRepo } from "#app/data/metrics/remote-repo.ts";
import { remoteProfilesRepo } from "#app/data/profiles/remote-repo.ts";
import { remoteRuntimeMetricsRepo } from "#app/data/profiles/runtime.ts";
import { runJobsOptions, runSpansOptions } from "#app/data/runs/options.ts";
import { remoteTracesRepo } from "#app/data/traces/remote-repo.ts";
import { sessionRecordingsHost } from "#app/routes/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/-recording/host.tsx";

function useCiRunSpans(traceId: string, enabled: boolean) {
  const spansQuery = useQuery({
    ...runSpansOptions(traceId),
    enabled,
    // Occurrences of one error tend to share a shape, so the list changes in
    // place instead of collapsing and regrowing.
    placeholderData: keepPreviousData,
  });
  return {
    spans: (spansQuery.data ?? []).map((span) => ({
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      durationMs: span.duration,
      conclusion: span.conclusion,
      jobName: span.jobName,
    })),
    isPending: spansQuery.isPending,
    isError: spansQuery.isError,
    isStale: spansQuery.isPlaceholderData,
    refetch: () => void spansQuery.refetch(),
  };
}

/**
 * What the Explore pages of `@everr/telemetry-explorer` read in this app. It goes into
 * the router context, so it is built once per router: per request on the
 * server, with that request's query client.
 */
export function createExploreBackend(queryClient: QueryClient): ExploreBackend {
  return {
    repos: {
      logs: remoteRepo,
      traces: remoteTracesRepo,
      metrics: remoteMetricsRepo,
      errors: remoteErrorsRepo,
      profiles: remoteProfilesRepo,
      runtimeMetrics: remoteRuntimeMetricsRepo,
    },
    useErrorTraceSpans: useCiRunSpans,
    sessionRecordings: sessionRecordingsHost,
    ciRunLinks: {
      resolveJobId: ({ traceId, jobName }) => {
        const cached = queryClient.getQueryData(runJobsOptions(traceId).queryKey);
        return Array.isArray(cached) ? cached.find((j) => j.name === jobName)?.jobId : undefined;
      },
      renderRunLink: ({ traceId, jobId, stepNumber }) => (
        <Button
          variant="outline"
          size="sm"
          className="mt-1 w-fit"
          nativeButton={false}
          render={
            <Link
              to="/runs/$traceId/jobs/$jobId/steps/$stepNumber"
              params={{ traceId, jobId, stepNumber }}
            />
          }
        >
          <FileSearch data-icon="inline-start" />
          Open in CI View
        </Button>
      ),
    },
  };
}
