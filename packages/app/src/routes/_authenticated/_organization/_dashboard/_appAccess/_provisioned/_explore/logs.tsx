import {
  LogsExplorer,
  type LogsExplorerSearch,
  LogsSearchSchema,
} from "@everr/telemetry-explorer/logs";
import { Button } from "@everr/ui/components/button";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { FileSearch } from "lucide-react";
import { ExplorePersistentFilters } from "@/components/explore-persistent-filters";
import { remoteRepo } from "@/data/logs-explorer/remote-repo";
import { runJobsOptions } from "@/data/runs/options";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/logs",
)({
  staticData: { breadcrumb: "Logs" },
  head: () => ({ meta: [{ title: "Everr - Logs" }] }),
  validateSearch: LogsSearchSchema,
  component: LogsExplorerPage,
});

function LogsExplorerPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const { service = [], environment = [] } = useSearch({
    from: "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore",
  });
  const { showVolume, ...rest } = search;
  const { timeRange, ...filters } = withTimeRange(rest);

  const explorerSearch: LogsExplorerSearch = {
    q: filters.q,
    levels: filters.levels,
    services: service,
    attributes: filters.attributes,
    traceId: filters.traceId,
    showVolume,
  };

  return (
    <LogsExplorer
      repo={remoteRepo}
      timeRange={timeRange}
      search={explorerSearch}
      environment={environment}
      persistentFilters={<ExplorePersistentFilters />}
      onSearchChange={({ services: _ignored, ...next }) =>
        // Push a history entry per change so Back undoes filter changes one at a
        // time (the time-range brush below stays on replace — it's continuous).
        navigate({
          search: (prev) => ({ ...prev, ...next }),
        })
      }
      onTimeRangeSelect={(from, to) =>
        navigate({
          search: (prev) => ({
            ...prev,
            from: from.toISOString(),
            to: to.toISOString(),
          }),
          replace: true,
        })
      }
      resolveJobId={({ traceId, jobName }) => {
        const cached = queryClient.getQueryData(
          runJobsOptions(traceId).queryKey,
        );
        return Array.isArray(cached)
          ? (cached as Array<{ name: string; jobId: string }>).find(
              (j) => j.name === jobName,
            )?.jobId
          : undefined;
      }}
      renderRunLink={({ traceId, jobId, stepNumber }) => (
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
      )}
    />
  );
}
