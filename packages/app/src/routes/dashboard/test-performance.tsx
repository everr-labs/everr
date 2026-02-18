import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CircleHelp } from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";
import { TestDurationTrendChart } from "@/components/results/test-duration-trend-chart";
import {
  ChildrenTable,
  TestPerfFailureHotspotsTable,
  TestPerfFailuresTable,
  TestPerfFilterBar,
  TestPerfScatterChart,
  TestPerfTreemap,
} from "@/components/test-performance";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  testPerfChildrenOptions,
  testPerfFailuresOptions,
  testPerfFilterOptionsOptions,
  testPerfScatterOptions,
  testPerfStatsOptions,
  testPerfTrendOptions,
} from "@/data/test-performance";
import { formatDurationCompact, testNameLastSegment } from "@/lib/formatting";
import { buildTestPerformanceBreadcrumb } from "@/lib/test-performance-breadcrumb";
import { resolveTimeRange, TimeRangeSearchSchema } from "@/lib/time-range";

export const Route = createFileRoute("/dashboard/test-performance")({
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
  }),
  loaderDeps: ({ search }) => ({
    timeRange: { from: search.from, to: search.to },
    repo: search.repo,
    pkg: search.pkg,
    testName: search.testName,
    branch: search.branch,
    path: search.path,
  }),
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
      queryClient.prefetchQuery(testPerfFilterOptionsOptions()),
      queryClient.prefetchQuery(testPerfChildrenOptions(childrenInput)),
    ];
    if (deps.pkg || deps.path) {
      prefetches.push(
        queryClient.prefetchQuery(testPerfStatsOptions(filterInput)),
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
  const { from, to, repo, pkg, testName, branch, path } = Route.useSearch();
  const isRootScope = !pkg && !path;
  const timeRange = { from, to };
  const { fromDate, toDate } = resolveTimeRange(timeRange);
  const filterInput = { timeRange, repo, pkg, testName, branch, path };
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const { data: stats } = useQuery({
    ...testPerfStatsOptions(filterInput),
    enabled: !isRootScope,
  });
  const { data: scatter } = useQuery({
    ...testPerfScatterOptions(filterInput),
    enabled: !isRootScope,
  });
  const { data: trend } = useQuery({
    ...testPerfTrendOptions(filterInput),
    enabled: !isRootScope,
  });
  const { data: failures } = useQuery({
    ...testPerfFailuresOptions(filterInput),
    enabled: !isRootScope,
  });
  const { data: filterOptions } = useQuery(testPerfFilterOptionsOptions());

  const childrenInput = { timeRange, repo, pkg, branch, path };
  const childrenQuery = useQuery(testPerfChildrenOptions(childrenInput));
  const children = childrenQuery.data ?? [];

  const isChildrenReady = childrenQuery.status === "success";
  const isLeaf = isChildrenReady && children.length === 0 && (pkg || path);
  const hasChildren = isChildrenReady && children.length > 0;

  const failureHotspots = useMemo(() => {
    const grouped = new Map<
      string,
      {
        testName: string;
        failureCount: number;
        latestTimestamp: string;
        avgDuration: number;
        latestTraceId: string;
      }
    >();
    for (const row of failures ?? []) {
      const existing = grouped.get(row.testName);
      if (!existing) {
        grouped.set(row.testName, {
          testName: row.testName,
          failureCount: 1,
          latestTimestamp: row.timestamp,
          avgDuration: row.duration,
          latestTraceId: row.traceId,
        });
        continue;
      }
      const newer = row.timestamp > existing.latestTimestamp;
      existing.failureCount += 1;
      existing.avgDuration =
        (existing.avgDuration * (existing.failureCount - 1) + row.duration) /
        existing.failureCount;
      if (newer) {
        existing.latestTimestamp = row.timestamp;
        existing.latestTraceId = row.traceId;
      }
    }
    return Array.from(grouped.values())
      .sort(
        (a, b) =>
          b.failureCount - a.failureCount ||
          b.latestTimestamp.localeCompare(a.latestTimestamp),
      )
      .slice(0, 20);
  }, [failures]);

  const updateFilter = (updates: Record<string, unknown>) => {
    navigate({ search: (prev) => ({ ...prev, ...updates }) });
  };

  // Build page title — use last segment of hierarchy
  let pageTitle = "Test Performance";
  if (path) {
    pageTitle = testNameLastSegment(path);
  } else if (pkg) {
    pageTitle = pkg;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1>
        <p className="text-muted-foreground">
          {isLeaf
            ? "Individual test execution metrics"
            : "Analyze test execution duration and failure patterns over time"}
        </p>
      </div>

      <TestPerfFilterBar
        filterOptions={filterOptions ?? { repos: [], branches: [] }}
        repo={repo}
        testName={testName}
        branch={branch}
        onRepoChange={(v) =>
          updateFilter({ repo: v, pkg: undefined, path: undefined })
        }
        onTestNameChange={(v) => updateFilter({ testName: v || undefined })}
        onBranchChange={(v) => updateFilter({ branch: v })}
      />

      {!isRootScope && (
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Execution Health" queries={[]}>
            {() => (
              <div className="space-y-2 pt-0">
                <div className="flex items-baseline justify-between gap-3 border-b pb-2">
                  <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                    Total Executions
                  </p>
                  <p className="text-2xl font-semibold tabular-nums leading-none">
                    {stats?.totalExecutions ?? "--"}
                  </p>
                </div>
                <div className="grid gap-1.5 grid-cols-3">
                  <div className="rounded border px-2 py-1.5">
                    <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                      Failure Rate
                    </p>
                    <p className="font-mono text-xs">
                      {stats ? `${stats.failureRate}%` : "--"}
                    </p>
                  </div>
                  <div className="rounded border px-2 py-1.5">
                    <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                      Failed Execs
                    </p>
                    <p className="font-mono text-xs">
                      {stats?.failExecutions ?? "--"}
                    </p>
                  </div>
                  <div className="rounded border px-2 py-1.5">
                    <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                      Unique Failures
                    </p>
                    <p className="font-mono text-xs">
                      {stats?.uniqueFailingTests ?? "--"}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </Panel>
          <Panel title="Duration Profile" queries={[]}>
            {() => (
              <div className="space-y-2 pt-0">
                <div className="flex items-baseline justify-between gap-3 border-b pb-2">
                  <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                    Average Duration
                  </p>
                  <p className="text-2xl font-semibold tabular-nums leading-none">
                    {stats
                      ? formatDurationCompact(stats.avgDuration, "s")
                      : "--"}
                  </p>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  <div className="rounded border px-1.5 py-1">
                    <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                      Median
                    </p>
                    <p className="font-mono text-xs">
                      {stats
                        ? formatDurationCompact(stats.medianDuration, "s")
                        : "--"}
                    </p>
                  </div>
                  <div className="rounded border px-1.5 py-1">
                    <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                      P95
                    </p>
                    <p className="font-mono text-xs">
                      {stats
                        ? formatDurationCompact(stats.p95Duration, "s")
                        : "--"}
                    </p>
                  </div>
                  <div className="rounded border px-1.5 py-1">
                    <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                      Max
                    </p>
                    <p className="font-mono text-xs">
                      {stats
                        ? formatDurationCompact(stats.maxDuration, "s")
                        : "--"}
                    </p>
                  </div>
                  <div className="rounded border px-1.5 py-1">
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
            )}
          </Panel>
        </div>
      )}

      {!isLeaf && hasChildren && (
        <div className={`grid gap-6 ${isRootScope ? "" : "xl:grid-cols-2"}`}>
          <Panel
            title={!pkg ? "Packages" : "Tests"}
            description={
              !pkg
                ? "Browse package hierarchy"
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
                      pkg: scope.pkg,
                      path: scope.path,
                    }),
                  )
                }
              />
            )}
          </Panel>

          {!isRootScope && (
            <Panel
              title="Failure Hotspots"
              description="Most frequently failing tests in the current scope"
              queries={[]}
            >
              {() => <TestPerfFailureHotspotsTable data={failureHotspots} />}
            </Panel>
          )}
        </div>
      )}

      {!isLeaf && hasChildren && (
        <Panel
          title="Execution Treemap"
          description="Size = average duration, color = failure rate. Click a block to drill down."
          queries={[]}
          inset="flush-content"
        >
          {() => (
            <TestPerfTreemap
              data={children}
              pkg={pkg}
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
