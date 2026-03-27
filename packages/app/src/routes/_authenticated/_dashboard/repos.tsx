import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Panel } from "@/components/panel";
import {
  ActiveBranchesTable,
  RepoDurationTrendChart,
  RepoHeader,
  RepoRecentRuns,
  RepoSuccessRateChart,
  TopFailingJobsTable,
} from "@/components/repo-detail";
import type { TimeRangeInput } from "@/data/analytics/schemas";
import {
  activeBranchesOptions,
  repoDurationTrendOptions,
  repoRecentRunsOptions,
  repoStatsOptions,
  repoSuccessRateTrendOptions,
  topFailingJobsOptions,
} from "@/data/repo-detail/options";
import { TimeRangeSearchSchema, withTimeRange } from "@/lib/time-range";

export const Route = createFileRoute("/_authenticated/_dashboard/repos")({
  staticData: { breadcrumb: "Repositories" },
  head: () => ({
    meta: [{ title: "Everr - Repositories" }],
  }),
  component: RepoDetailPage,
  validateSearch: TimeRangeSearchSchema.extend({
    name: z.string().default(""),
  }),
  loaderDeps: ({ search }) => withTimeRange(search),
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
});

function RepoDetailPage() {
  const { timeRange, name } = Route.useLoaderDeps();
  const input = { timeRange, repo: name };
  const enabled = !!name;
  const { data: stats } = useQuery({ ...repoStatsOptions(input), enabled });

  // Closures that bind `repo` so Panel can pass just { timeRange }
  const successRateTrend = (tr: TimeRangeInput) =>
    repoSuccessRateTrendOptions({ ...tr, repo: name });
  const durationTrend = (tr: TimeRangeInput) =>
    repoDurationTrendOptions({ ...tr, repo: name });
  const failingJobs = (tr: TimeRangeInput) =>
    topFailingJobsOptions({ ...tr, repo: name });
  const branches = (tr: TimeRangeInput) =>
    activeBranchesOptions({ ...tr, repo: name });
  const recentRuns = (tr: TimeRangeInput) =>
    repoRecentRunsOptions({ ...tr, repo: name });

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
        <Panel
          title="Success Rate"
          description="Build reliability over time"
          queries={[successRateTrend]}
        >
          {(data) => <RepoSuccessRateChart data={data} />}
        </Panel>

        <Panel
          title="Duration Trends"
          description="Job duration P50 and P95"
          queries={[durationTrend]}
        >
          {(data) => <RepoDurationTrendChart data={data} />}
        </Panel>
      </div>

      <Panel
        title="Top Failing Jobs"
        description="Jobs with the highest failure count"
        queries={[failingJobs]}
      >
        {(data) => <TopFailingJobsTable data={data} />}
      </Panel>

      <Panel
        title="Active Branches"
        description="Branches with recent activity"
        queries={[branches]}
      >
        {(data) => <ActiveBranchesTable data={data} />}
      </Panel>

      <Panel
        title="Recent Runs"
        description="Latest workflow runs for this repository"
        queries={[recentRuns]}
      >
        {(data) => <RepoRecentRuns data={data} />}
      </Panel>
    </div>
  );
}
