import { Badge } from "@everr/ui/components/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@everr/ui/components/chart";
import {
  ChartEmptyState,
  chartTooltipLabelFormatter,
  createChartTooltipFormatter,
  formatChartDate,
} from "@everr/ui/components/chart-helpers";
import { Skeleton } from "@everr/ui/components/skeleton";
import { Sparkline } from "@everr/ui/components/sparkline";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, Clock, DollarSign, TrendingUp } from "lucide-react";
import { ComposedChart, Line, XAxis, YAxis } from "recharts";
import { SuccessRateMiniChart } from "@/components/dashboard/success-rate-mini-chart";
import { RunsTable } from "@/components/runs-list";
import {
  workflowCostOptions,
  workflowDurationTrendOptions,
  workflowFailureReasonsOptions,
  workflowRecentRunsOptions,
  workflowStatsOptions,
  workflowSuccessRateTrendOptions,
  workflowTopFailingJobsOptions,
} from "@/data/workflows/options";
import { useTimeRange } from "@/hooks/use-time-range";
import {
  formatDuration,
  formatRelativeTime,
  getSuccessRateVariant,
} from "@/lib/formatting";
import { formatCost } from "@/lib/runner-pricing";
import { TimeRangeSearchSchema } from "@/lib/time-range";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/workflows/$repo/$workflowName",
)({
  head: ({ params }) => ({
    meta: [{ title: `Everr - ${decodeURIComponent(params.workflowName)}` }],
  }),
  component: WorkflowDetailPage,
  validateSearch: TimeRangeSearchSchema,
  pendingComponent: WorkflowDetailSkeleton,
});

// ── Helpers ──────────────────────────────────────────────────────────────

function DeltaIndicator({
  current,
  previous,
  invertColors = false,
}: {
  current: number;
  previous: number;
  invertColors?: boolean;
}) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return null;
  const delta = ((current - previous) / previous) * 100;
  if (Math.abs(delta) < 0.5) return null;
  const isPositive = delta > 0;
  const isGood = invertColors ? !isPositive : isPositive;
  return (
    <span
      className={`text-xs font-normal ${isGood ? "text-green-600" : "text-red-600"}`}
    >
      {isPositive ? "+" : ""}
      {Math.round(delta)}%
    </span>
  );
}

const durationChartConfig = {
  avgDuration: { label: "Avg Duration", color: "hsl(217, 91%, 60%)" },
  p95Duration: { label: "p95 Duration", color: "hsl(var(--muted))" },
} satisfies ChartConfig;

const durationTooltipFormatter = createChartTooltipFormatter(
  durationChartConfig,
  (v) => formatDuration(Number(v), "ms"),
);

// ── Page Component ───────────────────────────────────────────────────────

function WorkflowDetailPage() {
  const { workflowName: rawName, repo: rawRepo } = Route.useParams();
  const workflowName = decodeURIComponent(rawName);
  const repo = decodeURIComponent(rawRepo);
  const { timeRange } = useTimeRange();

  const detailInput = { timeRange, workflowName, repo };

  const { data: stats, isPending: statsPending } = useQuery(
    workflowStatsOptions(detailInput),
  );
  const { data: successTrend, isPending: successTrendPending } = useQuery(
    workflowSuccessRateTrendOptions(detailInput),
  );
  const { data: durationTrend, isPending: durationTrendPending } = useQuery(
    workflowDurationTrendOptions(detailInput),
  );
  const { data: cost } = useQuery(workflowCostOptions(detailInput));
  const { data: failingJobs, isPending: failingJobsPending } = useQuery(
    workflowTopFailingJobsOptions(detailInput),
  );
  const { data: failureReasons, isPending: failureReasonsPending } = useQuery(
    workflowFailureReasonsOptions(detailInput),
  );
  const { data: recentRuns, isPending: recentRunsPending } = useQuery(
    workflowRecentRunsOptions(detailInput),
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight">{workflowName}</h1>
        <p className="text-muted-foreground">{repo}</p>
      </div>
      {/* KPI stat cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statsPending || !stats ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-1">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-9 w-24" />
              </CardHeader>
            </Card>
          ))
        ) : (
          <>
            {/* Total Runs */}
            <Card className="relative">
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 opacity-15">
                <Sparkline
                  data={successTrend?.map((t) => t.totalRuns) ?? []}
                  className="h-full w-full"
                />
              </div>
              <CardHeader className="relative pb-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-xs">
                    Total Runs
                  </span>
                  <Activity className="text-muted-foreground size-4" />
                </div>
                <div className="text-3xl font-medium tabular-nums">
                  {stats.totalRuns.toLocaleString()}{" "}
                  <DeltaIndicator
                    current={stats.totalRuns}
                    previous={stats.prevTotalRuns}
                  />
                </div>
              </CardHeader>
            </Card>

            {/* Success Rate */}
            <Card className="relative">
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 opacity-15">
                <Sparkline
                  data={successTrend?.map((t) => t.successRate) ?? []}
                  maxValue={100}
                  className="h-full w-full"
                />
              </div>
              <CardHeader className="relative pb-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-xs">
                    Success Rate
                  </span>
                  <TrendingUp className="text-muted-foreground size-4" />
                </div>
                <div className="text-3xl font-medium tabular-nums">
                  <span
                    className={
                      stats.successRate >= 80
                        ? "text-green-600"
                        : stats.successRate >= 50
                          ? "text-yellow-600"
                          : "text-red-600"
                    }
                  >
                    {stats.successRate}%
                  </span>{" "}
                  <DeltaIndicator
                    current={stats.successRate}
                    previous={stats.prevSuccessRate}
                  />
                </div>
              </CardHeader>
            </Card>

            {/* Avg Duration */}
            <Card className="relative">
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 opacity-15">
                <Sparkline
                  data={durationTrend?.map((t) => t.avgDuration) ?? []}
                  className="h-full w-full"
                />
              </div>
              <CardHeader className="relative pb-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-xs">
                    Avg Duration
                  </span>
                  <Clock className="text-muted-foreground size-4" />
                </div>
                <div className="text-3xl font-medium tabular-nums">
                  {formatDuration(stats.avgDuration, "ms")}{" "}
                  <DeltaIndicator
                    current={stats.avgDuration}
                    previous={stats.prevAvgDuration}
                    invertColors
                  />
                </div>
              </CardHeader>
            </Card>

            {/* Est. Cost */}
            <Card className="relative">
              {cost && cost.overTime.length > 0 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 opacity-15">
                  <Sparkline data={cost.overTime} className="h-full w-full" />
                </div>
              )}
              <CardHeader className="relative pb-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-xs">
                    Est. Cost
                  </span>
                  <DollarSign className="text-muted-foreground size-4" />
                </div>
                <div className="text-3xl font-medium tabular-nums">
                  {cost ? formatCost(cost.totalCost) : "—"}{" "}
                  {cost && (
                    <DeltaIndicator
                      current={cost.totalCost}
                      previous={cost.prevTotalCost}
                      invertColors
                    />
                  )}
                </div>
                {cost && (
                  <p className="text-muted-foreground text-xs">
                    {Math.round(cost.totalMinutes)} min
                  </p>
                )}
              </CardHeader>
            </Card>
          </>
        )}
      </div>
      {/* Trend charts */}
      <div className="grid gap-3 md:grid-cols-2">
        {/* Success Rate Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Success Rate Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {successTrendPending ? (
              <Skeleton className="h-40 w-full" />
            ) : successTrend && successTrend.length > 0 ? (
              <SuccessRateMiniChart data={successTrend} />
            ) : (
              <ChartEmptyState message="No success rate data available" />
            )}
          </CardContent>
        </Card>

        {/* Duration Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Duration Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {durationTrendPending ? (
              <Skeleton className="h-40 w-full" />
            ) : durationTrend && durationTrend.length > 0 ? (
              <ChartContainer
                config={durationChartConfig}
                className="h-40 w-full"
              >
                <ComposedChart
                  data={durationTrend}
                  margin={{ left: -20, right: 4 }}
                >
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={4}
                    tickFormatter={formatChartDate}
                    fontSize={10}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={4}
                    tickFormatter={(v) => formatDuration(v, "ms")}
                    fontSize={10}
                    width={50}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={chartTooltipLabelFormatter}
                        formatter={durationTooltipFormatter}
                      />
                    }
                  />
                  <Line
                    dataKey="avgDuration"
                    type="monotone"
                    stroke="var(--color-avgDuration)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="p95Duration"
                    type="monotone"
                    stroke="var(--color-p95Duration)"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ChartContainer>
            ) : (
              <ChartEmptyState message="No duration data available" />
            )}
          </CardContent>
        </Card>
      </div>
      {/* Detail panels */}
      <div className="grid gap-3 md:grid-cols-2">
        {/* Top Failing Jobs */}
        <Card>
          <CardHeader>
            <CardTitle>Top Failing Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {failingJobsPending ? (
              <Skeleton className="h-[200px] w-full" />
            ) : failingJobs && failingJobs.length > 0 ? (
              <div className="space-y-3">
                {failingJobs.map((job) => (
                  <div
                    key={job.jobName}
                    className="flex items-center justify-between"
                  >
                    <div className="flex flex-col min-w-0 flex-1 mr-2">
                      <span className="text-sm font-medium truncate">
                        {job.jobName}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {job.totalRuns} runs
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={getSuccessRateVariant(job.successRate)}>
                        {job.successRate}%
                      </Badge>
                      <Badge variant="destructive">{job.failureCount}x</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                No failing jobs found
              </p>
            )}
          </CardContent>
        </Card>

        {/* Failure Reasons */}
        <Card>
          <CardHeader>
            <CardTitle>Failure Reasons</CardTitle>
          </CardHeader>
          <CardContent>
            {failureReasonsPending ? (
              <Skeleton className="h-[200px] w-full" />
            ) : failureReasons && failureReasons.length > 0 ? (
              <div className="space-y-3">
                {failureReasons.map((reason) => (
                  <div
                    key={reason.pattern}
                    className="flex items-center justify-between"
                  >
                    <div className="flex flex-col min-w-0 flex-1 mr-2">
                      <span className="text-sm font-medium truncate">
                        {reason.pattern}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatRelativeTime(reason.lastOccurrence)}
                      </span>
                    </div>
                    <Badge variant="secondary">{reason.count}x</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                No failure reasons found
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      {/* Recent Runs */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Runs</CardTitle>
          <CardAction>
            <Link
              to="/runs"
              search={{
                page: 1,
                workflowName,
                repo,
                branch: undefined,
                conclusion: undefined,
                runId: undefined,
              }}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              View all
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent>
          {recentRunsPending ? (
            <Skeleton className="h-[300px] w-full" />
          ) : recentRuns ? (
            <RunsTable data={recentRuns} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────

function WorkflowDetailSkeleton() {
  return (
    <div className="space-y-3">
      <div>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-1 h-4 w-64" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-1">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-24" />
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
