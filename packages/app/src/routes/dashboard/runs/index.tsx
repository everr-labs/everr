import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { TimeRangePicker } from "@/components/analytics";
import { Pagination, RunsFilterBar, RunsTable } from "@/components/runs-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { runFilterOptionsOptions, runsListOptions } from "@/data/runs-list";
import { parseTimeRangeFromSearch, type TimeRange } from "@/lib/time-range";

export const Route = createFileRoute("/dashboard/runs/")({
  component: RunsListPage,
  validateSearch: (search: Record<string, unknown>) => ({
    ...parseTimeRangeFromSearch(search),
    page: Number(search.page) || 1,
    repo: (search.repo as string) || undefined,
    branch: (search.branch as string) || undefined,
    conclusion: (search.conclusion as string) || undefined,
    workflowName: (search.workflowName as string) || undefined,
    runId: (search.runId as string) || undefined,
  }),
  loaderDeps: ({ search }) => ({
    timeRange: { from: search.from, to: search.to },
    page: search.page,
    repo: search.repo,
    branch: search.branch,
    conclusion: search.conclusion,
    workflowName: search.workflowName,
    runId: search.runId,
  }),
  loader: async ({ context: { queryClient }, deps }) => {
    const runsInput = {
      timeRange: deps.timeRange,
      page: deps.page,
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
  const { from, to, page, repo, branch, conclusion, workflowName, runId } =
    Route.useSearch();
  const timeRange = { from, to };
  const runsInput = {
    timeRange,
    page,
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

  const handleTimeRangeChange = (newRange: TimeRange) => {
    navigate({
      search: (prev) => ({
        ...prev,
        from: newRange.from,
        to: newRange.to,
        page: 1,
      }),
    });
  };

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
        <TimeRangePicker value={timeRange} onChange={handleTimeRangeChange} />
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
        pageSize={20}
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
