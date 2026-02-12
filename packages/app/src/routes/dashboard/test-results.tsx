import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { TimeRangePicker } from "@/components/analytics";
import { PackageResultsTable } from "@/components/results/package-results-table";
import { SlowestTestsTable } from "@/components/results/slowest-tests-table";
import { TestDurationTrendChart } from "@/components/results/test-duration-trend-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  slowestTestsOptions,
  testDurationTrendOptions,
  testResultsByPackageOptions,
  testResultsSummaryOptions,
} from "@/data/test-results";
import { type TimeRange, TimeRangeSearchSchema } from "@/lib/time-range";

export const Route = createFileRoute("/dashboard/test-results")({
  staticData: { breadcrumb: "Test Results" },
  component: TestResultsPage,
  validateSearch: TimeRangeSearchSchema,
  loaderDeps: ({ search }) => ({
    timeRange: { from: search.from, to: search.to },
  }),
  loader: async ({ context: { queryClient }, deps: { timeRange } }) => {
    const input = { timeRange };
    queryClient.prefetchQuery(testResultsSummaryOptions(input));
    queryClient.prefetchQuery(testResultsByPackageOptions(input));
    queryClient.prefetchQuery(slowestTestsOptions(input));
    queryClient.prefetchQuery(testDurationTrendOptions(input));
  },
  pendingComponent: TestResultsSkeleton,
});

function TestResultsPage() {
  const { from, to } = Route.useSearch();
  const timeRange = { from, to };
  const input = { timeRange };
  const { data: summary } = useQuery(testResultsSummaryOptions(input));
  const { data: byPackage } = useQuery(testResultsByPackageOptions(input));
  const { data: slowest } = useQuery(slowestTestsOptions(input));
  const { data: durationTrend } = useQuery(testDurationTrendOptions(input));
  const navigate = Route.useNavigate();

  if (!summary) return null;

  const handleTimeRangeChange = (newRange: TimeRange) => {
    navigate({ search: { from: newRange.from, to: newRange.to } });
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
        <TimeRangePicker value={timeRange} onChange={handleTimeRangeChange} />
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
          <TestDurationTrendChart data={durationTrend ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Results by Package</CardTitle>
          <CardDescription>Test results grouped by package</CardDescription>
        </CardHeader>
        <CardContent>
          <PackageResultsTable data={byPackage ?? []} />
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
          <SlowestTestsTable data={slowest ?? []} />
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
