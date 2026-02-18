import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Pagination } from "@/components/runs-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkflowsFilterBar } from "@/components/workflows/workflows-filter-bar";
import { WorkflowsTable } from "@/components/workflows/workflows-table";
import { runFilterOptionsOptions } from "@/data/runs-list";
import {
  workflowsListOptions,
  workflowsSparklineOptions,
} from "@/data/workflows";
import { DEFAULT_TIME_RANGE, TimeRangeSearchSchema } from "@/lib/time-range";

export const Route = createFileRoute("/dashboard/workflows/")({
  staticData: { breadcrumb: "Workflows" },
  component: WorkflowsListPage,
  validateSearch: TimeRangeSearchSchema.extend({
    page: z.coerce.number().default(1),
    repo: z.string().optional(),
    search: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({
    ...search,
    timeRange: {
      from: search.from ?? DEFAULT_TIME_RANGE.from,
      to: search.to ?? DEFAULT_TIME_RANGE.to,
    },
  }),
  loader: async ({ context: { queryClient }, deps }) => {
    const listInput = {
      timeRange: deps.timeRange,
      page: deps.page,
      repo: deps.repo,
      search: deps.search,
    };
    await Promise.all([
      queryClient.prefetchQuery(workflowsListOptions(listInput)),
      queryClient.prefetchQuery(runFilterOptionsOptions()),
    ]);
  },
  pendingComponent: WorkflowsListSkeleton,
});

function WorkflowsListPage() {
  const { timeRange, page, repo, search } = Route.useLoaderDeps();

  const { data: listResult } = useQuery(
    workflowsListOptions({ timeRange, page, repo, search }),
  );
  const { data: filterOptions } = useQuery(runFilterOptionsOptions());
  const { data: sparklines } = useQuery(
    workflowsSparklineOptions({
      timeRange,
      workflows:
        listResult?.workflows.map((w) => ({
          workflowName: w.workflowName,
          repo: w.repo,
        })) ?? [],
    }),
  );

  const navigate = Route.useNavigate();

  if (!listResult) return null;

  const updateFilter = (updates: Record<string, unknown>) => {
    navigate({ search: (prev) => ({ ...prev, ...updates, page: 1 }) });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
        <p className="text-muted-foreground">
          Aggregated view of your CI/CD workflows
        </p>
      </div>

      <WorkflowsFilterBar
        repos={filterOptions?.repos ?? []}
        repo={repo}
        search={search}
        onRepoChange={(v) => updateFilter({ repo: v })}
        onSearchChange={(v) => updateFilter({ search: v || undefined })}
      />

      <Card>
        <CardHeader>
          <CardTitle>All Workflows</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkflowsTable
            data={listResult.workflows}
            sparklines={sparklines ?? []}
          />
        </CardContent>
      </Card>

      <Pagination
        page={page}
        totalCount={listResult.totalCount}
        pageSize={20}
        onPageChange={(p) =>
          navigate({ search: (prev) => ({ ...prev, page: p }) })
        }
      />
    </div>
  );
}

function WorkflowsListSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-1 h-4 w-64" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-[180px]" />
        <Skeleton className="h-9 w-[200px]" />
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
