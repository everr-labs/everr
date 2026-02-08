import { createFileRoute } from "@tanstack/react-router";
import { TimeRangeSelect } from "@/components/analytics";
import {
  PackageResultsTable,
  SlowestTestsTable,
  TestDurationTrendChart,
} from "@/components/test-results";
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
  getSlowestTests,
  getTestDurationTrend,
  getTestResultsByPackage,
  getTestResultsSummary,
} from "@/data/test-results";

export const Route = createFileRoute("/dashboard/test-results")({
  component: TestResultsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    timeRange: (search.timeRange as TimeRange) || "7d",
  }),
  loaderDeps: ({ search }) => ({ timeRange: search.timeRange }),
  loader: async ({ deps: { timeRange } }) => {
    const [summary, byPackage, slowest, durationTrend] = await Promise.all([
      getTestResultsSummary({ data: { timeRange } }),
      getTestResultsByPackage({ data: { timeRange } }),
      getSlowestTests({ data: { timeRange } }),
      getTestDurationTrend({ data: { timeRange } }),
    ]);
    return { summary, byPackage, slowest, durationTrend };
  },
  pendingComponent: TestResultsSkeleton,
});

function TestResultsPage() {
  const { summary, byPackage, slowest, durationTrend } = Route.useLoaderData();
  const { timeRange } = Route.useSearch();
  const navigate = Route.useNavigate();

  const handleTimeRangeChange = (newRange: TimeRange) => {
    navigate({ search: { timeRange: newRange } });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Test Results</h1>
          <p className="text-muted-foreground">
            Test execution results across all repositories
          </p>
        </div>
        <TimeRangeSelect value={timeRange} onChange={handleTimeRangeChange} />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Tests</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary.totalTests}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pass</CardDescription>
            <CardTitle className="text-3xl tabular-nums text-green-600">
              {summary.passCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Fail</CardDescription>
            <CardTitle className="text-3xl tabular-nums text-red-600">
              {summary.failCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pass Rate</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary.passRate}%
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Test Duration Trend</CardTitle>
          <CardDescription>
            Average, P50, and P95 test duration over time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TestDurationTrendChart data={durationTrend} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Results by Package</CardTitle>
          <CardDescription>Test results grouped by package</CardDescription>
        </CardHeader>
        <CardContent>
          <PackageResultsTable data={byPackage} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Slowest Tests</CardTitle>
          <CardDescription>
            Top 20 tests by average execution time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SlowestTestsTable data={slowest} />
        </CardContent>
      </Card>
    </div>
  );
}

function TestResultsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-1 h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-[140px]" />
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
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-56" />
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
