import { createFileRoute } from "@tanstack/react-router";
import { TimeRangeSelect } from "@/components/analytics";
import { FlakinessTrendChart, FlakyTestsTable } from "@/components/flaky-tests";
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
  getFlakinessTrend,
  getFlakyTestSummary,
  getFlakyTests,
} from "@/data/flaky-tests";

export const Route = createFileRoute("/dashboard/flaky-tests/")({
  component: FlakyTestsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    timeRange: (search.timeRange as TimeRange) || "14d",
  }),
  loaderDeps: ({ search }) => ({ timeRange: search.timeRange }),
  loader: async ({ deps: { timeRange } }) => {
    const [flakyTests, summary, trend] = await Promise.all([
      getFlakyTests({ data: { timeRange } }),
      getFlakyTestSummary({ data: { timeRange } }),
      getFlakinessTrend({ data: { timeRange } }),
    ]);
    return { flakyTests, summary, trend };
  },
  pendingComponent: FlakyTestsSkeleton,
});

function FlakyTestsPage() {
  const { flakyTests, summary, trend } = Route.useLoaderData();
  const { timeRange } = Route.useSearch();
  const navigate = Route.useNavigate();

  const handleTimeRangeChange = (newRange: TimeRange) => {
    navigate({ search: { timeRange: newRange } });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Flaky Tests</h1>
          <p className="text-muted-foreground">
            Tests with inconsistent pass/fail results
          </p>
        </div>
        <TimeRangeSelect value={timeRange} onChange={handleTimeRangeChange} />
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Flaky Tests</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary.flakyTestCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Tests</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary.totalTestCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Flaky Percentage</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary.flakyPercentage}%
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Trend chart */}
      <Card>
        <CardHeader>
          <CardTitle>Flakiness Trend</CardTitle>
          <CardDescription>
            Number of flaky tests detected over time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FlakinessTrendChart data={trend} />
        </CardContent>
      </Card>

      {/* Flaky tests table */}
      <Card>
        <CardHeader>
          <CardTitle>Flaky Tests</CardTitle>
          <CardDescription>
            Ranked by failure rate (tests with both pass and fail results)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FlakyTestsTable data={flakyTests} />
        </CardContent>
      </Card>
    </div>
  );
}

function FlakyTestsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-1 h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-[140px]" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
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
