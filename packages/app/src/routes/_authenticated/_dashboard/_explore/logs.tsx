import {
  LogsExplorer,
  type LogsExplorerSearch,
  LogsSearchFiltersShape,
} from "@everr/telemetry-explorer/logs";
import { Button } from "@everr/ui/components/button";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { FileSearch } from "lucide-react";
import { z } from "zod";
import { remoteRepo } from "@/data/logs-explorer/remote-repo";
import { runJobsOptions } from "@/data/runs/options";
import { ExploreSearchShape } from "@/lib/explore-search";
import { TimeRangeSearchSchema } from "@/lib/time-range";

const SearchSchema = TimeRangeSearchSchema.extend({
  q: z.string().optional(),
  ...LogsSearchFiltersShape,
  ...ExploreSearchShape,
  traceId: z.string().optional(),
  showVolume: z.boolean().default(true),
}).omit({ services: true });

export const Route = createFileRoute("/_authenticated/_dashboard/_explore/logs")({
  staticData: { breadcrumb: "Logs" },
  validateSearch: SearchSchema,
  head: () => ({ meta: [{ title: "Everr - Logs" }] }),
  component: LogsExplorerPage,
});

function LogsExplorerPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const { service = [], environment = [] } = useSearch({
    from: "/_authenticated/_dashboard/_explore",
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
      hideSharedFilters
      onSearchChange={({ services: _ignored, ...next }) =>
        // Push a history entry per change so Back undoes filter changes one at a
        // time (the time-range brush below stays on replace — it's continuous).
        void navigate({
          search: (prev) => ({ ...prev, ...next }),
        })
      }
      onTimeRangeSelect={(from, to) =>
        void navigate({
          search: (prev) => ({
            ...prev,
            from: from.toISOString(),
            to: to.toISOString(),
          }),
          replace: true,
        })
      }
      resolveJobId={({ traceId, jobName }) => {
        const cached = queryClient.getQueryData(runJobsOptions(traceId).queryKey);
        return Array.isArray(cached) ? cached.find((j) => j.name === jobName)?.jobId : undefined;
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
