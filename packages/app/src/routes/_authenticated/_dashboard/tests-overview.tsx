import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CircleHelp } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { TestDurationTrendChart } from "@/components/results/test-duration-trend-chart";
import {
  ChildrenTable,
  getTreemapMetricLabel,
  TestPerfFailuresTable,
  TestPerfFilterBar,
  TestPerfScatterChart,
  TestPerfTreemap,
  TestPerfTreemapMetricToggle,
  type TreemapSizeMetric,
} from "@/components/test-performance";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  testPerfChildrenOptions,
  testPerfFilterOptionsOptions,
} from "@/data/test-performance/children";
import {
  testPerfFailuresOptions,
  testPerfScatterOptions,
  testPerfStatsOptions,
  testPerfStatsTrendOptions,
  testPerfTrendOptions,
} from "@/data/test-performance/metrics";
import { testResultsSummaryOptions } from "@/data/test-results";
import { formatDurationCompact, testNameLastSegment } from "@/lib/formatting";
import { buildTestPerformanceBreadcrumb } from "@/lib/test-performance-breadcrumb";
import {
  resolveTimeRange,
  TimeRangeSearchSchema,
  withTimeRange,
} from "@/lib/time-range";
import {
  fetchRepoMainBranches,
  repoMainBranchesQueryKey,
} from "./-main-branches-editor";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/tests-overview",
)({
  staticData: {
    breadcrumb: (match: { search?: { path?: string; pkg?: string } }) =>
      buildTestPerformanceBreadcrumb({
        pkg: match.search?.pkg,
        path: match.search?.path,
      }),
  },
  component: TestPerformancePage,
  validateSearch: TimeRangeSearchSchema.extend({
    repo: z.string().optional(),
    pkg: z.string().optional(),
    testName: z.string().optional(),
    branch: z.string().optional(),
    path: z.string().optional(),
    branches: z.enum(["main", "all"]).optional().catch("main"),
  }),
  loaderDeps: ({ search }) => withTimeRange(search),
  loader: async ({ context: { queryClient }, deps }) => {
    const filterInput = {
      timeRange: deps.timeRange,
      repo: deps.repo,
      pkg: deps.pkg,
      testName: deps.testName,
      branch: deps.branch,
      path: deps.path,
    };
    const childrenInput = {
      timeRange: deps.timeRange,
      repo: deps.repo,
      pkg: deps.pkg,
      branch: deps.branch,
      path: deps.path,
    };
    const prefetches = [
      queryClient.prefetchQuery(testResultsSummaryOptions(filterInput)),
      queryClient.prefetchQuery(testPerfFilterOptionsOptions()),
      queryClient.prefetchQuery(testPerfChildrenOptions(childrenInput)),
    ];
    if (deps.pkg || deps.path) {
      prefetches.push(
        queryClient.prefetchQuery(testPerfStatsOptions(filterInput)),
        queryClient.prefetchQuery(testPerfStatsTrendOptions(filterInput)),
        queryClient.prefetchQuery(testPerfScatterOptions(filterInput)),
        queryClient.prefetchQuery(testPerfTrendOptions(filterInput)),
        queryClient.prefetchQuery(testPerfFailuresOptions(filterInput)),
      );
    }
    await Promise.all(prefetches);
  },
  pendingComponent: TestPerformanceSkeleton,
});

function TestPerformancePage() {
  const { timeRange, repo, pkg, testName, branch, path } =
    Route.useLoaderDeps();
  const { branches: branchMode = "main" } = Route.useSearch();

  const isRootScope = !pkg && !path;
  const { fromDate, toDate } = resolveTimeRange(timeRange);
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const [treemapSizeMetric, setTreemapSizeMetric] =
    useState<TreemapSizeMetric>("avgDuration");

  // Fetch resolved main branches when in "main" mode
  const mainBranchesQuery = useQuery({
    queryKey: repoMainBranchesQueryKey(repo ?? ""),
    queryFn: () => fetchRepoMainBranches(repo ?? ""),
    enabled: branchMode === "main",
  });

  // Compute the branches filter to pass to all queries:
  // - "main" mode: pass the resolved string[] (or undefined while loading)
  // - "all" mode: pass null (no branch filter)
  const branchesFilter: string[] | null | undefined =
    branchMode === "all" ? null : mainBranchesQuery.data;

  const filterInput = {
    timeRange,
    repo,
    pkg,
    testName,
    branch,
    path,
    branches: branchesFilter,
  };
  const childrenInput = {
    timeRange,
    repo,
    pkg,
    branch,
    path,
    branches: branchesFilter,
  };

  // While in "main" mode, hold off queries until we have the branch list
  const branchesReady = branchMode === "all" || mainBranchesQuery.isSuccess;

  const { data: stats } = useQuery({
    ...testPerfStatsOptions(filterInput),
    enabled: !isRootScope && branchesReady,
  });
  const { data: summary } = useQuery({
    ...testResultsSummaryOptions(filterInput),
    enabled: branchesReady,
  });
  const { data: statsTrend } = useQuery({
    ...testPerfStatsTrendOptions(filterInput),
    enabled: !isRootScope && branchesReady,
  });
  const { data: scatter } = useQuery({
    ...testPerfScatterOptions(filterInput),
    enabled: !isRootScope && branchesReady,
  });
  const { data: trend } = useQuery({
    ...testPerfTrendOptions(filterInput),
    enabled: !isRootScope && branchesReady,
  });
  const { data: failures } = useQuery({
    ...testPerfFailuresOptions(filterInput),
    enabled: !isRootScope && branchesReady,
  });
  const { data: filterOptions } = useQuery(testPerfFilterOptionsOptions());

  const childrenQuery = useQuery({
    ...testPerfChildrenOptions(childrenInput),
    enabled: branchesReady,
  });
  const children = childrenQuery.data ?? [];

  const isChildrenReady = childrenQuery.status === "success";
  const isLeaf = isChildrenReady && children.length === 0 && (pkg || path);
  const hasChildren = isChildrenReady && children.length > 0;

  const executionTotalSeries = useMemo(
    () => (statsTrend ?? []).map((d) => d.totalExecutions),
    [statsTrend],
  );
  const executionFailureRateSeries = useMemo(
    () => (statsTrend ?? []).map((d) => d.failureRate),
    [statsTrend],
  );
  const executionFailSeries = useMemo(
    () => (statsTrend ?? []).map((d) => d.failExecutions),
    [statsTrend],
  );
  const executionUniqueFailSeries = useMemo(
    () => (statsTrend ?? []).map((d) => d.uniqueFailingTests),
    [statsTrend],
  );
  const durationAvgSeries = useMemo(
    () => (statsTrend ?? []).map((d) => d.avgDuration),
    [statsTrend],
  );
  const durationMedianSeries = useMemo(
    () => (statsTrend ?? []).map((d) => d.medianDuration),
    [statsTrend],
  );
  const durationP95Series = useMemo(
    () => (statsTrend ?? []).map((d) => d.p95Duration),
    [statsTrend],
  );
  const durationMaxSeries = useMemo(
    () => (statsTrend ?? []).map((d) => d.maxDuration),
    [statsTrend],
  );
  const durationCvSeries = useMemo(
    () => (statsTrend ?? []).map((d) => d.coefficientOfVariation),
    [statsTrend],
  );

  const updateFilter = (updates: Record<string, unknown>) => {
    navigate({ search: (prev) => ({ ...prev, ...updates }) });
  };

  // Build page title — use last segment of hierarchy
  let pageTitle = "Tests Overview";
  if (path) {
    pageTitle = testNameLastSegment(path);
  } else if (pkg) {
    pageTitle = pkg;
  }

  const isMainBranchesEmpty =
    branchMode === "main" &&
    branchesReady &&
    summary?.totalTests === 0 &&
    children.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1>
          <p className="text-muted-foreground">
            {isLeaf
              ? "Individual test execution metrics"
              : "Analyze test execution duration and failure patterns over time"}
          </p>
        </div>
        <ToggleGroup
          value={[branchMode]}
          variant="outline"
          size="sm"
          spacing={0}
          onValueChange={(next) => {
            const selected = next[0];
            if (selected === "all") {
              navigate({ search: (prev) => ({ ...prev, branches: "all" }) });
            } else if (selected === "main") {
              navigate({
                search: (prev) => ({ ...prev, branches: undefined }),
              });
            }
          }}
          aria-label="Branch scope"
        >
          <ToggleGroupItem value="main" aria-label="Main branches">
            Main branches
          </ToggleGroupItem>
          <ToggleGroupItem value="all" aria-label="All branches">
            All branches
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <TestPerfFilterBar
        filterOptions={filterOptions ?? { repos: [], branches: [] }}
        repo={repo}
        branch={branch}
        onRepoChange={(v) =>
          updateFilter({ repo: v, pkg: undefined, path: undefined })
        }
        onBranchChange={(v) => updateFilter({ branch: v })}
      />

      {isMainBranchesEmpty && (
        <p className="text-muted-foreground text-sm">
          No runs on main branches in this period.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <p className="text-muted-foreground text-sm">Total Tests</p>
            <p className="text-3xl font-semibold tabular-nums">
              {summary?.totalTests ?? "--"}
            </p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <p className="text-muted-foreground text-sm">Pass</p>
            <p className="text-3xl font-semibold tabular-nums text-green-600">
              {summary?.passCount ?? "--"}
            </p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <p className="text-muted-foreground text-sm">Fail</p>
            <p className="text-3xl font-semibold tabular-nums text-red-600">
              {summary?.failCount ?? "--"}
            </p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <p className="text-muted-foreground text-sm">Pass Rate</p>
            <p className="text-3xl font-semibold tabular-nums">
              {summary ? `${summary.passRate}%` : "--"}
            </p>
          </CardHeader>
        </Card>
      </div>

      {!isRootScope && (
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Execution Health" queries={[]}>
            {() => (
              <div className="space-y-2 pt-0">
                <div className="relative overflow-hidden rounded border-b pb-2">
                  <Sparkline
                    data={executionTotalSeries}
                    className="pointer-events-none absolute inset-0 opacity-25"
                    color="hsl(214, 84%, 56%)"
                  />
                  <div className="relative flex items-baseline justify-between gap-3">
                    <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                      Total Executions
                    </p>
                    <p className="text-2xl font-semibold tabular-nums leading-none">
                      {stats?.totalExecutions ?? "--"}
                    </p>
                  </div>
                </div>
                <div className="grid gap-1.5 grid-cols-3">
                  <div className="relative overflow-hidden rounded border px-2 py-1.5">
                    <Sparkline
                      data={executionFailureRateSeries}
                      className="pointer-events-none absolute inset-0 opacity-25"
                      color="hsl(10, 85%, 58%)"
                      maxValue={100}
                    />
                    <div className="relative">
                      <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                        Failure Rate
                      </p>
                      <p className="font-mono text-xs">
                        {stats ? `${stats.failureRate}%` : "--"}
                      </p>
                    </div>
                  </div>
                  <div className="relative overflow-hidden rounded border px-2 py-1.5">
                    <Sparkline
                      data={executionFailSeries}
                      className="pointer-events-none absolute inset-0 opacity-25"
                      color="hsl(20, 90%, 52%)"
                    />
                    <div className="relative">
                      <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                        Failed Execs
                      </p>
                      <p className="font-mono text-xs">
                        {stats?.failExecutions ?? "--"}
                      </p>
                    </div>
                  </div>
                  <div className="relative overflow-hidden rounded border px-2 py-1.5">
                    <Sparkline
                      data={executionUniqueFailSeries}
                      className="pointer-events-none absolute inset-0 opacity-25"
                      color="hsl(30, 88%, 50%)"
                    />
                    <div className="relative">
                      <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                        Unique Failures
                      </p>
                      <p className="font-mono text-xs">
                        {stats?.uniqueFailingTests ?? "--"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Panel>
          <Panel title="Duration Profile" queries={[]}>
            {() => (
              <div className="space-y-2 pt-0">
                <div className="relative overflow-hidden rounded border-b pb-2">
                  <Sparkline
                    data={durationAvgSeries}
                    className="pointer-events-none absolute inset-0 opacity-25"
                    color="hsl(173, 80%, 36%)"
                  />
                  <div className="relative flex items-baseline justify-between gap-3">
                    <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                      Average Duration
                    </p>
                    <p className="text-2xl font-semibold tabular-nums leading-none">
                      {stats
                        ? formatDurationCompact(stats.avgDuration, "s")
                        : "--"}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  <div className="relative overflow-hidden rounded border px-1.5 py-1">
                    <Sparkline
                      data={durationMedianSeries}
                      className="pointer-events-none absolute inset-0 opacity-25"
                      color="hsl(179, 80%, 34%)"
                    />
                    <div className="relative">
                      <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                        Median
                      </p>
                      <p className="font-mono text-xs">
                        {stats
                          ? formatDurationCompact(stats.medianDuration, "s")
                          : "--"}
                      </p>
                    </div>
                  </div>
                  <div className="relative overflow-hidden rounded border px-1.5 py-1">
                    <Sparkline
                      data={durationP95Series}
                      className="pointer-events-none absolute inset-0 opacity-25"
                      color="hsl(192, 82%, 36%)"
                    />
                    <div className="relative">
                      <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                        P95
                      </p>
                      <p className="font-mono text-xs">
                        {stats
                          ? formatDurationCompact(stats.p95Duration, "s")
                          : "--"}
                      </p>
                    </div>
                  </div>
                  <div className="relative overflow-hidden rounded border px-1.5 py-1">
                    <Sparkline
                      data={durationMaxSeries}
                      className="pointer-events-none absolute inset-0 opacity-25"
                      color="hsl(203, 84%, 40%)"
                    />
                    <div className="relative">
                      <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                        Max
                      </p>
                      <p className="font-mono text-xs">
                        {stats
                          ? formatDurationCompact(stats.maxDuration, "s")
                          : "--"}
                      </p>
                    </div>
                  </div>
                  <div className="relative overflow-hidden rounded border px-1.5 py-1">
                    <Sparkline
                      data={durationCvSeries}
                      className="pointer-events-none absolute inset-0 opacity-25"
                      color="hsl(221, 83%, 56%)"
                    />
                    <div className="relative">
                      <p className="text-muted-foreground inline-flex items-center gap-1 text-[10px] uppercase tracking-wide">
                        CV
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground"
                                aria-label="What is CV?"
                              />
                            }
                          >
                            <CircleHelp className="size-3.5" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-64">
                            Coefficient of variation (CV) = std dev / mean. It
                            shows relative spread, so higher CV means test
                            durations are less stable and less predictable.
                          </TooltipContent>
                        </Tooltip>
                      </p>
                      <p className="font-mono text-xs">
                        {stats ? `${stats.coefficientOfVariation}%` : "--"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Panel>
        </div>
      )}

      {!isLeaf && hasChildren && (
        <Panel
          title="Execution Treemap"
          description={`Size = ${getTreemapMetricLabel(
            treemapSizeMetric,
          )}, color = failure rate, tag = package / suite / test. Click a block to drill down.`}
          queries={[]}
          inset="flush-content"
          action={
            <TestPerfTreemapMetricToggle
              value={treemapSizeMetric}
              onChange={setTreemapSizeMetric}
            />
          }
        >
          {() => (
            <TestPerfTreemap
              data={children}
              pkg={pkg}
              sizeMetric={treemapSizeMetric}
              onSelect={(name) => {
                if (!pkg) {
                  updateFilter({ pkg: name, path: undefined });
                  return;
                }
                updateFilter({ pkg, path: name });
              }}
            />
          )}
        </Panel>
      )}

      {!isLeaf && hasChildren && (
        <div className={`grid gap-6`}>
          <Panel
            title={!pkg ? "Packages" : "Suites & Tests"}
            description={
              !pkg
                ? "Browse packages and drill into suites or individual tests"
                : "Drill into suites/tests and compare failures and duration trends"
            }
            queries={[]}
            inset="flush-content"
          >
            {() => (
              <ChildrenTable
                data={children}
                pkg={pkg}
                repo={repo}
                branch={branch}
                timeRange={timeRange}
                fetchChildren={(scope) =>
                  queryClient.fetchQuery(
                    testPerfChildrenOptions({
                      timeRange,
                      repo,
                      branch,
                      branches: branchesFilter,
                      pkg: scope.pkg,
                      path: scope.path,
                    }),
                  )
                }
              />
            )}
          </Panel>
        </div>
      )}

      {!isRootScope && (
        <>
          <Panel
            title="Duration Trend"
            description="Average, P50, and P95 test duration over time"
            queries={[]}
          >
            {() => <TestDurationTrendChart data={trend ?? []} />}
          </Panel>

          <Panel
            title="Test Duration Distribution"
            description="Each dot is one test execution. Color = outcome, shape = branch type (circle = main, triangle = other). Click a dot to view the CI run."
            queries={[]}
          >
            {() => (
              <TestPerfScatterChart
                data={scatter ?? []}
                fromTimestamp={fromDate.getTime()}
                toTimestamp={toDate.getTime()}
              />
            )}
          </Panel>

          <Panel
            title="Recent Failures"
            description="Most recent test failures with links to CI runs"
            queries={[]}
          >
            {() => <TestPerfFailuresTable data={failures ?? []} />}
          </Panel>
        </>
      )}
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
        {Array.from({ length: 3 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton items
          <Skeleton key={i} className="h-9 w-[160px]" />
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
