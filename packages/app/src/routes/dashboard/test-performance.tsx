import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TestDurationTrendChart } from "@/components/results/test-duration-trend-chart";
import {
  TestPerfFailuresTable,
  TestPerfFilterBar,
  TestPerfScatterChart,
} from "@/components/test-performance";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  testPerfFailuresOptions,
  testPerfFilterOptionsOptions,
  testPerfPackagesOptions,
  testPerfScatterOptions,
  testPerfStatsOptions,
  testPerfTrendOptions,
} from "@/data/test-performance";
import { formatDurationCompact } from "@/lib/formatting";
import { TimeRangeSearchSchema } from "@/lib/time-range";

export const Route = createFileRoute("/dashboard/test-performance")({
  staticData: { breadcrumb: "Test Performance" },
  component: TestPerformancePage,
  validateSearch: TimeRangeSearchSchema.extend({
    repo: z.string().optional(),
    pkg: z.string().optional(),
    testName: z.string().optional(),
    branch: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({
    timeRange: { from: search.from, to: search.to },
    repo: search.repo,
    pkg: search.pkg,
    testName: search.testName,
    branch: search.branch,
  }),
  loader: async ({ context: { queryClient }, deps }) => {
    const filterInput = {
      timeRange: deps.timeRange,
      repo: deps.repo,
      pkg: deps.pkg,
      testName: deps.testName,
      branch: deps.branch,
    };
    await Promise.all([
      queryClient.prefetchQuery(testPerfStatsOptions(filterInput)),
      queryClient.prefetchQuery(testPerfScatterOptions(filterInput)),
      queryClient.prefetchQuery(testPerfTrendOptions(filterInput)),
      queryClient.prefetchQuery(testPerfFailuresOptions(filterInput)),
      queryClient.prefetchQuery(testPerfFilterOptionsOptions()),
      queryClient.prefetchQuery(
        testPerfPackagesOptions({
          timeRange: deps.timeRange,
          repo: deps.repo,
        }),
      ),
    ]);
  },
  pendingComponent: TestPerformanceSkeleton,
});

function TestPerformancePage() {
  const { from, to, repo, pkg, testName, branch } = Route.useSearch();
  const timeRange = { from, to };
  const filterInput = { timeRange, repo, pkg, testName, branch };
  const navigate = Route.useNavigate();

  const { data: stats } = useQuery(testPerfStatsOptions(filterInput));
  const { data: scatter } = useQuery(testPerfScatterOptions(filterInput));
  const { data: trend } = useQuery(testPerfTrendOptions(filterInput));
  const { data: failures } = useQuery(testPerfFailuresOptions(filterInput));
  const { data: filterOptions } = useQuery(testPerfFilterOptionsOptions());
  const { data: packages } = useQuery(
    testPerfPackagesOptions({ timeRange, repo }),
  );

  const updateFilter = (updates: Record<string, unknown>) => {
    navigate({ search: (prev) => ({ ...prev, ...updates }) });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Test Performance</h1>
        <p className="text-muted-foreground">
          Analyze test execution duration and failure patterns over time
        </p>
      </div>

      <TestPerfFilterBar
        filterOptions={filterOptions ?? { repos: [], branches: [] }}
        packages={packages ?? []}
        repo={repo}
        pkg={pkg}
        testName={testName}
        branch={branch}
        onRepoChange={(v) => updateFilter({ repo: v, pkg: undefined })}
        onPackageChange={(v) => updateFilter({ pkg: v })}
        onTestNameChange={(v) => updateFilter({ testName: v || undefined })}
        onBranchChange={(v) => updateFilter({ branch: v })}
      />

      {/* KPI Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Executions</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {stats?.totalExecutions ?? "--"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Duration</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {stats ? formatDurationCompact(stats.avgDuration, "s") : "--"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>P95 Duration</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {stats ? formatDurationCompact(stats.p95Duration, "s") : "--"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Failure Rate</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {stats ? `${stats.failureRate}%` : "--"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Scatter Plot */}
      <Card>
        <CardHeader>
          <CardTitle>Test Duration Distribution</CardTitle>
          <CardDescription>
            Each dot is one test execution. Color = outcome, shape = branch type
            (circle = main, triangle = other). Click a dot to view the CI run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TestPerfScatterChart data={scatter ?? []} />
        </CardContent>
      </Card>

      {/* Duration Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Duration Trend</CardTitle>
          <CardDescription>
            Average, P50, and P95 test duration over time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TestDurationTrendChart data={trend ?? []} />
        </CardContent>
      </Card>

      {/* Failures Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Failures</CardTitle>
          <CardDescription>
            Most recent test failures with links to CI runs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TestPerfFailuresTable data={failures ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}

function TestPerformanceSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-1 h-4 w-80" />
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton items
          <Skeleton key={i} className="h-9 w-[160px]" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton items
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-16" />
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
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
