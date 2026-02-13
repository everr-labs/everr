import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  FlakyTestTimeline,
  RunnerFlakinessTable,
  TestResultHeatmap,
} from "@/components/flaky-tests";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  runnerFlakinessOptions,
  testDailyResultsOptions,
  testHistoryOptions,
} from "@/data/flaky-tests";
import { formatRelativeTime } from "@/lib/formatting";
import { TimeRangeSearchSchema } from "@/lib/time-range";

export const Route = createFileRoute("/dashboard/flaky-tests/detail")({
  staticData: {
    breadcrumb: (match: { search?: { test?: string } }) =>
      match.search?.test ?? "Test Detail",
  },
  component: FlakyTestDetailPage,
  validateSearch: TimeRangeSearchSchema.extend({
    from: z.string().default("now-30d"),
    to: z.string().default("now"),
    repo: z.string().default(""),
    test: z.string().default(""),
  }),
  loaderDeps: ({ search }) => ({
    repo: search.repo,
    test: search.test,
    timeRange: { from: search.from, to: search.to },
  }),
  loader: async ({
    context: { queryClient },
    deps: { repo, test, timeRange },
  }) => {
    if (!repo || !test) {
      return;
    }
    const detailInput = { timeRange, repo, testFullName: test };
    await Promise.all([
      queryClient.prefetchQuery(testHistoryOptions(detailInput)),
      queryClient.prefetchQuery(runnerFlakinessOptions(detailInput)),
      queryClient.prefetchQuery(testDailyResultsOptions(detailInput)),
    ]);
  },
  pendingComponent: FlakyTestDetailSkeleton,
});

function FlakyTestDetailPage() {
  const { from, to, repo, test } = Route.useSearch();
  const timeRange = { from, to };

  const detailInput = { timeRange, repo, testFullName: test };
  const enabled = !!repo && !!test;
  const { data: history } = useQuery({
    ...testHistoryOptions(detailInput),
    enabled,
  });
  const { data: runners } = useQuery({
    ...runnerFlakinessOptions(detailInput),
    enabled,
  });
  const { data: dailyResults } = useQuery({
    ...testDailyResultsOptions(detailInput),
    enabled,
  });

  if (!repo || !test) {
    return (
      <div className="flex h-[400px] items-center justify-center text-muted-foreground">
        No test specified. Select a test from the flaky tests list.
      </div>
    );
  }

  if (!history) return null;

  // Calculate summary from history
  const passCount = history.filter((h) => h.testResult === "pass").length;
  const failCount = history.filter((h) => h.testResult === "fail").length;
  const failureRate =
    passCount + failCount > 0
      ? Math.round((failCount / (passCount + failCount)) * 1000) / 10
      : 0;

  // First seen from daily results
  const firstSeenDate =
    dailyResults && dailyResults.length > 0 ? dailyResults[0].date : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight break-all">
            {test}
          </h1>
          <p className="text-muted-foreground">{repo}</p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 md:grid-cols-4">
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
        {firstSeenDate && (
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>First Seen</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {formatRelativeTime(firstSeenDate)}
              </CardTitle>
            </CardHeader>
          </Card>
        )}
      </div>

      {/* Result pattern heatmap */}
      {dailyResults && dailyResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Result Pattern</CardTitle>
            <CardDescription>
              Daily pass/fail distribution over time
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TestResultHeatmap data={dailyResults ?? []} />
          </CardContent>
        </Card>
      )}

      {/* Runner breakdown */}
      {runners && runners.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Runner Breakdown</CardTitle>
            <CardDescription>
              Failure rate by runner (surfaces environment-specific flakiness)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RunnerFlakinessTable data={runners ?? []} />
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
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[60px] w-full" />
        </CardContent>
      </Card>

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
