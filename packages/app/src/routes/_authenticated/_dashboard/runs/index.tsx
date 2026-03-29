import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Pagination, RunsFilterBar, RunsTable } from "@/components/runs-list";
import { runsListOptions } from "@/data/runs-list/options";
import { useRealtimeSubscription } from "@/hooks/use-realtime-subscription";
import { TimeRangeSearchSchema, withTimeRange } from "@/lib/time-range";

const PAGE_SIZE = 20;

export const Route = createFileRoute("/_authenticated/_dashboard/runs/")({
  component: RunsListPage,
  validateSearch: TimeRangeSearchSchema.extend({
    page: z.coerce.number().int().default(1),
    repos: z.array(z.string()).default([]),
    branches: z.array(z.string()).default([]),
    conclusions: z
      .array(z.enum(["success", "failure", "cancellation"]))
      .default([]),
    workflowNames: z.array(z.string()).default([]),
    runId: z.string().optional(),
  }),
  loaderDeps: ({ search }) => withTimeRange(search),
  loader: async ({ context: { queryClient }, deps }) => {
    const runsInput = {
      timeRange: deps.timeRange,
      limit: PAGE_SIZE,
      offset: (deps.page - 1) * PAGE_SIZE,
      repos: deps.repos,
      branches: deps.branches,
      conclusions: deps.conclusions,
      workflowNames: deps.workflowNames,
      runId: deps.runId,
    };
    await queryClient.prefetchQuery(runsListOptions(runsInput));
  },
  pendingComponent: RunsListSkeleton,
});

function RunsListPage() {
  useRealtimeSubscription({ scope: "tenant" });
  const {
    timeRange,
    page,
    repos,
    branches,
    conclusions,
    workflowNames,
    runId,
  } = Route.useLoaderDeps();

  const runsInput = {
    timeRange,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    repos,
    branches,
    conclusions,
    workflowNames,
    runId,
  };
  const { data: runsResult } = useQuery(runsListOptions(runsInput));
  const navigate = Route.useNavigate();

  if (!runsResult) return null;

  const updateFilter = (updates: Record<string, unknown>) => {
    navigate({ search: (prev) => ({ ...prev, ...updates, page: 1 }) });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Runs</h1>
          <p className="text-muted-foreground">
            Browse and filter workflow runs
          </p>
        </div>
      </div>

      <RunsFilterBar
        timeRange={timeRange}
        repos={repos}
        branches={branches}
        conclusions={conclusions}
        workflowNames={workflowNames}
        runId={runId}
        onReposChange={(v) => updateFilter({ repos: v })}
        onBranchesChange={(v) => updateFilter({ branches: v })}
        onConclusionsChange={(v) => updateFilter({ conclusions: v })}
        onWorkflowNamesChange={(v) => updateFilter({ workflowNames: v })}
        onRunIdChange={(v) => updateFilter({ runId: v || undefined })}
      />

      <Card>
        <CardHeader>
          <CardTitle>Workflow Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <RunsTable data={runsResult.runs} />
        </CardContent>
      </Card>

      <Pagination
        page={page}
        totalCount={runsResult.totalCount}
        pageSize={PAGE_SIZE}
        onPageChange={(p) =>
          navigate({ search: (prev) => ({ ...prev, page: p }) })
        }
      />
    </div>
  );
}

function RunsListSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="mt-1 h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-[140px]" />
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-[160px]" />
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
