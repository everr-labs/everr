import { Badge } from "@everr/ui/components/badge";
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
import { Sparkline } from "@everr/ui/components/sparkline";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, Clock, DollarSign, TrendingUp } from "lucide-react";
import { ComposedChart, Line, XAxis, YAxis } from "recharts";
import { SuccessRateMiniChart } from "@/components/dashboard/success-rate-mini-chart";
import { RunsTable } from "@/components/runs-list";
import { TimeRangePanel } from "@/components/time-range-panel";
import type { TimeRangeInput } from "@/data/analytics/schemas";
import {
  workflowCostOptions,
  workflowDurationTrendOptions,
  workflowFailureReasonsOptions,
  workflowRecentRunsOptions,
  workflowStatsOptions,
  workflowSuccessRateTrendOptions,
  workflowTopFailingJobsOptions,
} from "@/data/workflows/options";
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

  // Closures that bind workflowName + repo so Panel can pass just { timeRange }
  const wfStats = (tr: TimeRangeInput) =>
    workflowStatsOptions({ ...tr, workflowName, repo });
  const wfSuccessTrend = (tr: TimeRangeInput) =>
    workflowSuccessRateTrendOptions({ ...tr, workflowName, repo });
  const wfDurationTrend = (tr: TimeRangeInput) =>
    workflowDurationTrendOptions({ ...tr, workflowName, repo });
  const wfCost = (tr: TimeRangeInput) =>
    workflowCostOptions({ ...tr, workflowName, repo });
  const wfFailingJobs = (tr: TimeRangeInput) =>
    workflowTopFailingJobsOptions({ ...tr, workflowName, repo });
  const wfFailureReasons = (tr: TimeRangeInput) =>
    workflowFailureReasonsOptions({ ...tr, workflowName, repo });
  const wfRecentRuns = (tr: TimeRangeInput) =>
    workflowRecentRunsOptions({ ...tr, workflowName, repo });

  return (
    <div className="space-y-3">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight">{workflowName}</h1>
        <p className="text-muted-foreground">{repo}</p>
      </div>

      {/* KPI stat cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TimeRangePanel
          title="Total Runs"
          queries={[wfStats, wfSuccessTrend]}
          variant="stat"
          icon={Activity}
          background={(_stats, trends) => (
            <Sparkline
              data={trends.map((t) => t.totalRuns)}
              className="h-full w-full"
            />
          )}
        >
          {(stats) => (
            <>
              {stats.totalRuns.toLocaleString()}{" "}
              <DeltaIndicator
                current={stats.totalRuns}
                previous={stats.prevTotalRuns}
              />
            </>
          )}
        </TimeRangePanel>

        <TimeRangePanel
          title="Success Rate"
          queries={[wfStats, wfSuccessTrend]}
          variant="stat"
          icon={TrendingUp}
          background={(_stats, trends) => (
            <Sparkline
              data={trends.map((t) => t.successRate)}
              maxValue={100}
              className="h-full w-full"
            />
          )}
        >
          {(stats) => (
            <>
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
            </>
          )}
        </TimeRangePanel>

        <TimeRangePanel
          title="Avg Duration"
          queries={[wfStats, wfDurationTrend]}
          variant="stat"
          icon={Clock}
          background={(_stats, trends) => (
            <Sparkline
              data={trends.map((t) => t.avgDuration)}
              className="h-full w-full"
            />
          )}
        >
          {(stats) => (
            <>
              {formatDuration(stats.avgDuration, "ms")}{" "}
              <DeltaIndicator
                current={stats.avgDuration}
                previous={stats.prevAvgDuration}
                invertColors
              />
            </>
          )}
        </TimeRangePanel>

        <TimeRangePanel
          title="Est. Cost"
          queries={[wfCost]}
          variant="stat"
          icon={DollarSign}
          background={(cost) =>
            cost.overTime.length > 0 ? (
              <Sparkline data={cost.overTime} className="h-full w-full" />
            ) : null
          }
        >
          {(cost) => (
            <>
              {formatCost(cost.totalCost)}{" "}
              <DeltaIndicator
                current={cost.totalCost}
                previous={cost.prevTotalCost}
                invertColors
              />
              <p className="text-muted-foreground text-xs font-normal">
                {Math.round(cost.totalMinutes)} min
              </p>
            </>
          )}
        </TimeRangePanel>
      </div>

      {/* Trend charts */}
      <div className="grid gap-3 md:grid-cols-2">
        <TimeRangePanel
          title="Success Rate Trend"
          queries={[wfSuccessTrend]}
          skeleton={<div className="h-40" />}
        >
          {(data) =>
            data.length > 0 ? (
              <SuccessRateMiniChart data={data} />
            ) : (
              <ChartEmptyState message="No success rate data available" />
            )
          }
        </TimeRangePanel>

        <TimeRangePanel
          title="Duration Trend"
          queries={[wfDurationTrend]}
          skeleton={<div className="h-40" />}
        >
          {(data) =>
            data.length > 0 ? (
              <ChartContainer
                config={durationChartConfig}
                className="h-40 w-full"
              >
                <ComposedChart data={data} margin={{ left: -20, right: 4 }}>
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
            )
          }
        </TimeRangePanel>
      </div>

      {/* Detail panels */}
      <div className="grid gap-3 md:grid-cols-2">
        <TimeRangePanel title="Top Failing Jobs" queries={[wfFailingJobs]}>
          {(jobs) =>
            jobs.length > 0 ? (
              <div className="space-y-3">
                {jobs.map((job) => (
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
            )
          }
        </TimeRangePanel>

        <TimeRangePanel title="Failure Reasons" queries={[wfFailureReasons]}>
          {(reasons) =>
            reasons.length > 0 ? (
              <div className="space-y-3">
                {reasons.map((reason) => (
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
            )
          }
        </TimeRangePanel>
      </div>

      {/* Recent Runs */}
      <TimeRangePanel
        title="Recent Runs"
        queries={[wfRecentRuns]}
        inset="flush-content"
        action={
          <Link
            to="/runs"
            search={{
              page: 1,
              workflowNames: [workflowName],
              repos: [repo],
              branches: [],
              conclusions: [],
              runId: undefined,
            }}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            View all
          </Link>
        }
      >
        {(runs) => <RunsTable data={runs} />}
      </TimeRangePanel>
    </div>
  );
}
