import {
  LogLevelSchema,
  LogsExplorer,
  type LogsExplorerSearch,
} from "@everr/telemetry-explorer/logs";
import { Button } from "@everr/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FileSearch } from "lucide-react";
import { z } from "zod";
import { remoteRepo } from "@/data/logs-explorer/remote-repo";
import { runJobsOptions } from "@/data/runs/options";
import { TimeRangeSearchSchema, withTimeRange } from "@/lib/time-range";

const SearchSchema = TimeRangeSearchSchema.extend({
  q: z.string().optional(),
  levels: z.array(LogLevelSchema).default([]),
  services: z.array(z.string()).default([]),
  repos: z.array(z.string()).default([]),
  traceId: z.string().optional(),
  showVolume: z.boolean().default(true),
});

export const Route = createFileRoute("/_authenticated/_dashboard/logs")({
  staticData: { breadcrumb: "Logs", fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Logs" }] }),
  validateSearch: SearchSchema,
  component: LogsExplorerPage,
});

function LogsExplorerPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const { showVolume, ...rest } = search;
  const { timeRange, ...filters } = withTimeRange(rest);

  const explorerSearch: LogsExplorerSearch = {
    q: filters.q,
    levels: filters.levels,
    services: filters.services,
    repos: filters.repos,
    traceId: filters.traceId,
    showVolume,
  };

  return (
    <LogsExplorer
      repo={remoteRepo}
      timeRange={timeRange}
      search={explorerSearch}
      onSearchChange={(next) =>
        navigate({
          search: (prev) => ({ ...prev, ...next }),
          replace: true,
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
