import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
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
import {
  activeBranchesOptions,
  repoDurationTrendOptions,
  repoRecentRunsOptions,
  repoStatsOptions,
  repoSuccessRateTrendOptions,
  topFailingJobsOptions,
} from "@/data/repo-detail";
import { TimeRangeSearchSchema } from "@/lib/time-range";

export const Route = createFileRoute("/dashboard/repos")({
  staticData: { breadcrumb: "Repositories" },
  component: RepoDetailPage,
  validateSearch: TimeRangeSearchSchema.extend({
    name: z.string().default(""),
  }),
  loaderDeps: ({ search }) => ({
    name: search.name,
    timeRange: { from: search.from, to: search.to },
  }),
  loader: async ({ context: { queryClient }, deps }) => {
    if (!deps.name) {
      return;
    }
    const input = { timeRange: deps.timeRange, repo: deps.name };
    await Promise.all([
      queryClient.prefetchQuery(repoStatsOptions(input)),
      queryClient.prefetchQuery(repoSuccessRateTrendOptions(input)),
      queryClient.prefetchQuery(repoDurationTrendOptions(input)),
      queryClient.prefetchQuery(repoRecentRunsOptions(input)),
      queryClient.prefetchQuery(topFailingJobsOptions(input)),
      queryClient.prefetchQuery(activeBranchesOptions(input)),
    ]);
  },
  pendingComponent: RepoDetailSkeleton,
});

function RepoDetailPage() {
  const { name, from, to } = Route.useSearch();
  const timeRange = { from, to };

  const input = { timeRange, repo: name };
  const enabled = !!name;
  const { data: stats } = useQuery({ ...repoStatsOptions(input), enabled });
  const { data: successTrend } = useQuery({
    ...repoSuccessRateTrendOptions(input),
    enabled,
  });
  const { data: durationTrend } = useQuery({
    ...repoDurationTrendOptions(input),
    enabled,
  });
  const { data: recentRuns } = useQuery({
    ...repoRecentRunsOptions(input),
    enabled,
  });
  const { data: failingJobs } = useQuery({
    ...topFailingJobsOptions(input),
    enabled,
  });
  const { data: branches } = useQuery({
    ...activeBranchesOptions(input),
    enabled,
  });

  if (!name) {
    return (
      <div className="flex h-[400px] items-center justify-center text-muted-foreground text-sm">
        Select a repository to view details. Navigate from the overview page or
        use ?name=owner/repo.
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <RepoHeader name={name} stats={stats} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Success Rate</CardTitle>
            <CardDescription>Build reliability over time</CardDescription>
          </CardHeader>
          <CardContent>
            <RepoSuccessRateChart data={successTrend ?? []} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Duration Trends</CardTitle>
            <CardDescription>Job duration P50 and P95</CardDescription>
          </CardHeader>
          <CardContent>
            <RepoDurationTrendChart data={durationTrend ?? []} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top Failing Jobs</CardTitle>
          <CardDescription>Jobs with the highest failure count</CardDescription>
        </CardHeader>
        <CardContent>
          <TopFailingJobsTable data={failingJobs ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Branches</CardTitle>
          <CardDescription>Branches with recent activity</CardDescription>
        </CardHeader>
        <CardContent>
          <ActiveBranchesTable data={branches ?? []} />
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
          <RepoRecentRuns data={recentRuns ?? []} />
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
