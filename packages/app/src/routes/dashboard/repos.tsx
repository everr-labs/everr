import { createFileRoute } from "@tanstack/react-router";
import { TimeRangeSelect } from "@/components/analytics";
import {
  ActiveBranchesTable,
  RepoDurationTrendChart,
  RepoHeader,
  RepoRecentRuns,
  RepoSuccessRateChart,
  TopFailingJobsTable,
} from "@/components/repo-detail";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { TimeRange } from "@/data/analytics";
import {
  getActiveBranches,
  getRepoDurationTrend,
  getRepoRecentRuns,
  getRepoStats,
  getRepoSuccessRateTrend,
  getTopFailingJobs,
} from "@/data/repo-detail";

export const Route = createFileRoute("/dashboard/repos")({
  component: RepoDetailPage,
  validateSearch: (search: Record<string, unknown>) => ({
    name: (search.name as string) || "",
    timeRange: (search.timeRange as TimeRange) || "7d",
  }),
  loaderDeps: ({ search }) => ({
    name: search.name,
    timeRange: search.timeRange,
  }),
  loader: async ({ deps }) => {
    if (!deps.name) {
      return null;
    }
    const input = { timeRange: deps.timeRange, repo: deps.name };
    const [
      stats,
      successTrend,
      durationTrend,
      recentRuns,
      failingJobs,
      branches,
    ] = await Promise.all([
      getRepoStats({ data: input }),
      getRepoSuccessRateTrend({ data: input }),
      getRepoDurationTrend({ data: input }),
      getRepoRecentRuns({ data: input }),
      getTopFailingJobs({ data: input }),
      getActiveBranches({ data: input }),
    ]);
    return {
      stats,
      successTrend,
      durationTrend,
      recentRuns,
      failingJobs,
      branches,
    };
  },
  pendingComponent: RepoDetailSkeleton,
});

function RepoDetailPage() {
  const data = Route.useLoaderData();
  const { name, timeRange } = Route.useSearch();
  const navigate = Route.useNavigate();

  if (!data || !name) {
    return (
      <div className="flex h-[400px] items-center justify-center text-muted-foreground text-sm">
        Select a repository to view details. Navigate from the overview page or
        use ?name=owner/repo.
      </div>
    );
  }

  const handleTimeRangeChange = (newRange: TimeRange) => {
    navigate({ search: (prev) => ({ ...prev, timeRange: newRange }) });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <RepoHeader name={name} stats={data.stats} />
        <TimeRangeSelect value={timeRange} onChange={handleTimeRangeChange} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Success Rate</CardTitle>
            <CardDescription>Build reliability over time</CardDescription>
          </CardHeader>
          <CardContent>
            <RepoSuccessRateChart data={data.successTrend} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Duration Trends</CardTitle>
            <CardDescription>Job duration P50 and P95</CardDescription>
          </CardHeader>
          <CardContent>
            <RepoDurationTrendChart data={data.durationTrend} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top Failing Jobs</CardTitle>
          <CardDescription>Jobs with the highest failure count</CardDescription>
        </CardHeader>
        <CardContent>
          <TopFailingJobsTable data={data.failingJobs} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Branches</CardTitle>
          <CardDescription>Branches with recent activity</CardDescription>
        </CardHeader>
        <CardContent>
          <ActiveBranchesTable data={data.branches} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Runs</CardTitle>
          <CardDescription>
            Latest workflow runs for this repository
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RepoRecentRuns data={data.recentRuns} />
        </CardContent>
      </Card>
    </div>
  );
}

function RepoDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-48" />
          <div className="mt-2 flex gap-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
        <Skeleton className="h-10 w-[140px]" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton items
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[300px] w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
