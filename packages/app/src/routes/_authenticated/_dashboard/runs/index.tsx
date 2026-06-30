import { withTimeRange } from "@everr/ui/lib/time-range";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { RunsExplorer } from "@/components/runs-list/runs-explorer";
import { useRealtimeSubscription } from "@/hooks/use-realtime-subscription";
import { TimeRangeSearchSchema } from "@/lib/time-range";

// `.catch([])` keeps the page resilient to malformed array params — e.g. the
// auth redirect serializes an empty array as `repos=` (a bare string), which a
// plain `z.array()` would reject and crash the route on.
const SearchSchema = TimeRangeSearchSchema.extend({
  runId: z.string().optional().catch(undefined),
  repos: z.array(z.string()).default([]).catch([]),
  branches: z.array(z.string()).default([]).catch([]),
  conclusions: z
    .array(z.enum(["success", "failure", "cancellation"]))
    .default([])
    .catch([]),
  workflowNames: z.array(z.string()).default([]).catch([]),
  showVolume: z.boolean().default(true).catch(true),
});

export const Route = createFileRoute("/_authenticated/_dashboard/runs/")({
  staticData: { fullBleed: true },
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
      timeRange={timeRange}
      search={{
        runId: search.runId,
        repos: search.repos,
        branches: search.branches,
        conclusions: search.conclusions,
        workflowNames: search.workflowNames,
        showVolume: search.showVolume,
      }}
      // Each filter mutation pushes a history entry so Back undoes one change at
      // a time; the histogram brush replaces (it's a continuous adjustment).
      onSearchChange={(patch) =>
        navigate({ search: (prev) => ({ ...prev, ...patch }) })
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
    />
  );
}
