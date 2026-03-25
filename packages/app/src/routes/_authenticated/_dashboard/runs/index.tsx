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
import {
  runFilterOptionsOptions,
  runsListOptions,
} from "@/data/runs-list/options";
import { useRealtimeSubscription } from "@/hooks/use-realtime-subscription";
import { TimeRangeSearchSchema, withTimeRange } from "@/lib/time-range";

const PAGE_SIZE = 20;

export const Route = createFileRoute("/_authenticated/_dashboard/runs/")({
  component: RunsListPage,
  validateSearch: TimeRangeSearchSchema.extend({
    page: z.coerce.number().int().default(1),
    repo: z.string().optional(),
    branch: z.string().optional(),
    conclusion: z.enum(["success", "failure", "cancellation"]).optional(),
    workflowName: z.string().optional(),
    runId: z.string().optional(),
  }),
  loaderDeps: ({ search }) => withTimeRange(search),
  loader: async ({ context: { queryClient }, deps }) => {
    const runsInput = {
      timeRange: deps.timeRange,
      limit: PAGE_SIZE,
      offset: (deps.page - 1) * PAGE_SIZE,
      repo: deps.repo,
      branch: deps.branch,
      conclusion: deps.conclusion,
      workflowName: deps.workflowName,
      runId: deps.runId,
    };
    await Promise.all([
      queryClient.prefetchQuery(runsListOptions(runsInput)),
      queryClient.prefetchQuery(runFilterOptionsOptions()),
    ]);
  },
  pendingComponent: RunsListSkeleton,
});

function RunsListPage() {
  useRealtimeSubscription({ scope: "tenant" });
  const { timeRange, page, repo, branch, conclusion, workflowName, runId } =
    Route.useLoaderDeps();

  const runsInput = {
    timeRange,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    repo,
    branch,
    conclusion,
    workflowName,
    runId,
  };
  const { data: runsResult } = useQuery(runsListOptions(runsInput));
  const { data: filterOptions } = useQuery(runFilterOptionsOptions());
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
        filterOptions={
          filterOptions ?? { repos: [], branches: [], workflowNames: [] }
        }
        repo={repo}
        branch={branch}
        conclusion={conclusion}
        workflowName={workflowName}
        runId={runId}
        onRepoChange={(v) => updateFilter({ repo: v })}
        onBranchChange={(v) => updateFilter({ branch: v })}
        onConclusionChange={(v) => updateFilter({ conclusion: v })}
        onWorkflowNameChange={(v) => updateFilter({ workflowName: v })}
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
          // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton items
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
