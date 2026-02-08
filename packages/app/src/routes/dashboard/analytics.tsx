import { createFileRoute } from "@tanstack/react-router";
import {
  DurationTrendsChart,
  QueueTimeChart,
  RunnerUtilizationChart,
  SuccessRateChart,
  TimeRangeSelect,
} from "@/components/analytics";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getDurationTrends,
  getQueueTimeAnalysis,
  getRunnerUtilization,
  getSuccessRateTrends,
  type TimeRange,
} from "@/data/analytics";

export const Route = createFileRoute("/dashboard/analytics")({
  component: AnalyticsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    timeRange: (search.timeRange as TimeRange) || "7d",
  }),
  loaderDeps: ({ search }) => ({ timeRange: search.timeRange }),
  loader: async ({ deps: { timeRange } }) => {
    const [
      durationTrends,
      queueTimeAnalysis,
      successRateTrends,
      runnerUtilization,
    ] = await Promise.all([
      getDurationTrends({ data: { timeRange } }),
      getQueueTimeAnalysis({ data: { timeRange } }),
      getSuccessRateTrends({ data: { timeRange } }),
      getRunnerUtilization({ data: { timeRange } }),
    ]);
    return {
      durationTrends,
      queueTimeAnalysis,
      successRateTrends,
      runnerUtilization,
    };
  },
  pendingComponent: AnalyticsSkeleton,
});

function AnalyticsPage() {
  const {
    durationTrends,
    queueTimeAnalysis,
    successRateTrends,
    runnerUtilization,
  } = Route.useLoaderData();
  const { timeRange } = Route.useSearch();
  const navigate = Route.useNavigate();

  const handleTimeRangeChange = (newRange: TimeRange) => {
    navigate({ search: { timeRange: newRange } });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">CI/CD performance insights</p>
        </div>
        <TimeRangeSelect value={timeRange} onChange={handleTimeRangeChange} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Duration Trends</CardTitle>
            <CardDescription>
              Job duration over time (avg, p50, p95)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DurationTrendsChart data={durationTrends} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Queue Time Analysis</CardTitle>
            <CardDescription>Wait time before jobs start</CardDescription>
          </CardHeader>
          <CardContent>
            <QueueTimeChart data={queueTimeAnalysis} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Success Rate Trends</CardTitle>
            <CardDescription>Build reliability over time</CardDescription>
          </CardHeader>
          <CardContent>
            <SuccessRateChart data={successRateTrends} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Runner Utilization</CardTitle>
            <CardDescription>
              Most used runners and their metrics
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RunnerUtilizationChart data={runnerUtilization} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="mt-1 h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-[140px]" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
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
    </div>
  );
}
