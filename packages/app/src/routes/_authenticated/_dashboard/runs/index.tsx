import { RUN_STATUS_FILTERS, RunsExplorer } from "@everr/telemetry-explorer/runs";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { runsRepository } from "@/data/runs-list/repository";
import { useRealtimeSubscription } from "@/hooks/use-realtime-subscription";
import { TimeRangeSearchSchema } from "@/lib/time-range";

// `.catch([])` keeps the page resilient to malformed array params — e.g. the
// auth redirect serializes an empty array as `repos=` (a bare string), which a
// plain `z.array()` would reject and crash the route on.
const SearchSchema = TimeRangeSearchSchema.extend({
  runId: z.string().optional().catch(undefined),
  repos: z.array(z.string()).default([]).catch([]),
  branches: z.array(z.string()).default([]).catch([]),
  conclusions: z.array(z.enum(RUN_STATUS_FILTERS)).default([]).catch([]),
  workflowNames: z.array(z.string()).default([]).catch([]),
  showVolume: z.boolean().default(true).catch(true),
});

export const Route = createFileRoute("/_authenticated/_dashboard/runs/")({
  validateSearch: SearchSchema,
  component: RunsListPage,
});

function RunsListPage() {
  useRealtimeSubscription({ scope: "tenant" });
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { timeRange } = withTimeRange(search);

  return (
    <RunsExplorer
      repo={runsRepository}
      timeRange={timeRange}
      // The web shows all org runs and doesn't expose the "mine" filter, so
      // `onlyMine` is a constant and isn't part of the URL schema.
      showMineFilter={false}
      search={{
        runId: search.runId,
        repos: search.repos,
        branches: search.branches,
        conclusions: search.conclusions,
        workflowNames: search.workflowNames,
        onlyMine: false,
        showVolume: search.showVolume,
      }}
      // Each filter mutation pushes a history entry so Back undoes one change at
      // a time; the histogram brush replaces (it's a continuous adjustment).
      onSearchChange={(patch) => navigate({ search: (prev) => ({ ...prev, ...patch }) })}
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
      renderRunLink={({ run, className, children }) => (
        <Link to="/runs/$traceId" params={{ traceId: run.traceId }} className={className}>
          {children}
        </Link>
      )}
    />
  );
}
