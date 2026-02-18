import { useQuery } from "@tanstack/react-query";
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
    await Promise.all([
      queryClient.prefetchQuery(testPerfStatsOptions(filterInput)),
      queryClient.prefetchQuery(testPerfScatterOptions(filterInput)),
      queryClient.prefetchQuery(testPerfTrendOptions(filterInput)),
      queryClient.prefetchQuery(testPerfFailuresOptions(filterInput)),
      queryClient.prefetchQuery(testPerfFilterOptionsOptions()),
      queryClient.prefetchQuery(testPerfChildrenOptions(childrenInput)),
    ]);
  },
  pendingComponent: TestPerformanceSkeleton,
});

function TestPerformancePage() {
  const { from, to, repo, pkg, testName, branch, path } = Route.useSearch();
  const timeRange = { from, to };
  const { fromDate, toDate } = resolveTimeRange(timeRange);
  const filterInput = { timeRange, repo, pkg, testName, branch, path };
  const navigate = Route.useNavigate();

  const { data: stats } = useQuery(testPerfStatsOptions(filterInput));
  const { data: scatter } = useQuery(testPerfScatterOptions(filterInput));
  const { data: trend } = useQuery(testPerfTrendOptions(filterInput));
  const { data: failures } = useQuery(testPerfFailuresOptions(filterInput));
  const { data: filterOptions } = useQuery(testPerfFilterOptionsOptions());

  const childrenInput = { timeRange, repo, pkg, branch, path };
  const { data: children } = useQuery(testPerfChildrenOptions(childrenInput));

  const isLeaf =
    children !== undefined && children.length === 0 && (pkg || path);
  const hasChildren = children !== undefined && children.length > 0;

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

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Execution Health</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
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
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Duration Profile</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <div className="flex items-baseline justify-between gap-3 border-b pb-2">
              <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                Average Duration
              </p>
              <p className="text-2xl font-semibold tabular-nums leading-none">
                {stats ? formatDurationCompact(stats.avgDuration, "s") : "--"}
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
                  {stats ? formatDurationCompact(stats.p95Duration, "s") : "--"}
                </p>
              </div>
              <div className="rounded border px-1.5 py-1">
                <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                  Max
                </p>
                <p className="font-mono text-xs">
                  {stats ? formatDurationCompact(stats.maxDuration, "s") : "--"}
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
                      Coefficient of variation (CV) = std dev / mean. It shows
                      relative spread, so higher CV means test durations are
                      less stable and less predictable.
                    </TooltipContent>
                  </Tooltip>
                </p>
                <p className="font-mono text-xs">
                  {stats ? `${stats.coefficientOfVariation}%` : "--"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{!pkg ? "Packages" : "Tests"}</CardTitle>
            <CardDescription>
              {!pkg
                ? "Browse package hierarchy while keeping diagnostics visible below"
                : "Drill into suites/tests and compare failures and duration trends"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasChildren ? (
              <ChildrenTable data={children} pkg={pkg} />
            ) : (
              <p className="py-2 text-sm text-muted-foreground">
                No further children at this scope.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Failure Hotspots</CardTitle>
            <CardDescription>
              Most frequently failing tests in the current scope
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TestPerfFailureHotspotsTable data={failureHotspots} />
          </CardContent>
        </Card>
      </div>

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

      <Card>
        <CardHeader>
          <CardTitle>Test Duration Distribution</CardTitle>
          <CardDescription>
            Each dot is one test execution. Color = outcome, shape = branch type
            (circle = main, triangle = other). Click a dot to view the CI run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TestPerfScatterChart
            data={scatter ?? []}
            fromTimestamp={fromDate.getTime()}
            toTimestamp={toDate.getTime()}
          />
        </CardContent>
      </Card>

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
