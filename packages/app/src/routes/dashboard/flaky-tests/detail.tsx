import { createFileRoute } from "@tanstack/react-router";
import { TimeRangeSelect } from "@/components/analytics";
import {
  FlakyTestTimeline,
  RunnerFlakinessTable,
} from "@/components/flaky-tests";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { TimeRange } from "@/data/analytics";
import { getRunnerFlakiness, getTestHistory } from "@/data/flaky-tests";

export const Route = createFileRoute("/dashboard/flaky-tests/detail")({
  component: FlakyTestDetailPage,
  validateSearch: (search: Record<string, unknown>) => ({
    repo: (search.repo as string) || "",
    test: (search.test as string) || "",
    timeRange: (search.timeRange as TimeRange) || "30d",
  }),
  loaderDeps: ({ search }) => ({
    repo: search.repo,
    test: search.test,
    timeRange: search.timeRange,
  }),
  loader: async ({ deps: { repo, test, timeRange } }) => {
    if (!repo || !test) {
      return { history: [], runners: [], repo: "", test: "" };
    }

    const [history, runners] = await Promise.all([
      getTestHistory({
        data: { timeRange, repo, testFullName: test },
      }),
      getRunnerFlakiness({
        data: { timeRange, repo, testFullName: test },
      }),
    ]);
    return { history, runners, repo, test };
  },
  pendingComponent: FlakyTestDetailSkeleton,
});

function FlakyTestDetailPage() {
  const { history, runners, repo, test } = Route.useLoaderData();
  const { timeRange } = Route.useSearch();
  const navigate = Route.useNavigate();

  const handleTimeRangeChange = (newRange: TimeRange) => {
    navigate({ search: (prev) => ({ ...prev, timeRange: newRange }) });
  };

  if (!repo || !test) {
    return (
      <div className="flex h-[400px] items-center justify-center text-muted-foreground">
        No test specified. Select a test from the flaky tests list.
      </div>
    );
  }

  // Calculate summary from history
  const passCount = history.filter((h) => h.testResult === "pass").length;
  const failCount = history.filter((h) => h.testResult === "fail").length;
  const failureRate =
    passCount + failCount > 0
      ? Math.round((failCount / (passCount + failCount)) * 1000) / 10
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight break-all">
            {test}
          </h1>
          <p className="text-muted-foreground">{repo}</p>
        </div>
        <TimeRangeSelect value={timeRange} onChange={handleTimeRangeChange} />
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Failure Rate</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {failureRate}%
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pass / Fail</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              <span className="text-green-600">{passCount}</span>
              {" / "}
              <span className="text-red-600">{failCount}</span>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Executions</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {history.length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Runner breakdown */}
      {runners.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Runner Breakdown</CardTitle>
            <CardDescription>
              Failure rate by runner (surfaces environment-specific flakiness)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RunnerFlakinessTable data={runners} />
          </CardContent>
        </Card>
      )}

      {/* Execution history */}
      <Card>
        <CardHeader>
          <CardTitle>Execution History</CardTitle>
          <CardDescription>
            Recent test executions across all runs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FlakyTestTimeline data={history} />
        </CardContent>
      </Card>
    </div>
  );
}

function FlakyTestDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-1 h-4 w-48" />
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
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
