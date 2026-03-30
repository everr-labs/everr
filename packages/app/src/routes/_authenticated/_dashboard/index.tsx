import { Badge } from "@everr/ui/components/badge";
import { Sparkline } from "@everr/ui/components/sparkline";
import { SiGithub } from "@icons-pack/react-simple-icons";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ChevronRight,
  Clock,
  DollarSign,
  GitBranch,
  Hash,
  TrendingUp,
} from "lucide-react";
import { SuccessRateMiniChart } from "@/components/dashboard/success-rate-mini-chart";
import { ConclusionIcon } from "@/components/run-detail/conclusion-icon";
import { TimeRangePanel } from "@/components/time-range-panel";
import {
  durationTrendsOptions,
  successRateTrendsOptions,
} from "@/data/analytics/options";
import { costOverviewOptions } from "@/data/cost-analysis/options";
import {
  dashboardDurationStatsOptions,
  dashboardStatsOptions,
  repositoriesOptions,
  topFailingJobsOptions,
  topFailingWorkflowsOptions,
} from "@/data/dashboard-stats/options";
import { latestRunsOptions } from "@/data/runs/options";
import {
  formatDuration,
  formatRelativeTime,
  getSuccessRateVariant,
} from "@/lib/formatting";
import { formatCost } from "@/lib/runner-pricing";
import { TimeRangeSearchSchema } from "@/lib/time-range";

export const Route = createFileRoute("/_authenticated/_dashboard/")({
  staticData: { breadcrumb: "Overview" },
  head: () => ({
    meta: [{ title: "Everr - Overview" }],
  }),
  component: DashboardPage,
  validateSearch: TimeRangeSearchSchema,
});

function DashboardPage() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of your CI/CD pipelines
          </p>
        </div>
      </div>

      {/* Section 1: KPI stat cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TimeRangePanel
          title="Total Runs"
          queries={[dashboardStatsOptions, successRateTrendsOptions]}
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
              {stats.totalJobRuns.toLocaleString()}
              <div className="text-muted-foreground text-xs font-normal mt-1">
                {stats.successfulRuns} passed / {stats.failedRuns} failed
              </div>
            </>
          )}
        </TimeRangePanel>

        <TimeRangePanel
          title="Success Rate"
          queries={[dashboardStatsOptions, successRateTrendsOptions]}
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
              </span>
              <div className="text-muted-foreground text-xs font-normal mt-1">
                of all runs passed
              </div>
            </>
          )}
        </TimeRangePanel>

        <TimeRangePanel
          title="Avg Duration"
          queries={[dashboardDurationStatsOptions, durationTrendsOptions]}
          variant="stat"
          icon={Clock}
          background={(_duration, trends) => (
            <Sparkline
              data={trends.map((t) => t.avgDuration)}
              className="h-full w-full"
            />
          )}
        >
          {(duration) => (
            <>
              {formatDuration(duration.avgDuration, "ms")}
              <div className="text-muted-foreground text-xs font-normal mt-1">
                p95: {formatDuration(duration.p95Duration, "ms")}
              </div>
            </>
          )}
        </TimeRangePanel>

        <TimeRangePanel
          title="Est. Cost"
          queries={[costOverviewOptions]}
          variant="stat"
          icon={DollarSign}
          background={(cost) => (
            <Sparkline
              data={cost.overTime.map((p) => p.totalCost)}
              className="h-full w-full"
            />
          )}
        >
          {(cost) => (
            <>
              {formatCost(cost.summary.totalCost)}
              <div className="text-muted-foreground text-xs font-normal mt-1">
                {Math.round(cost.summary.totalMinutes)} min
              </div>
            </>
          )}
        </TimeRangePanel>
      </div>

      {/* Section 2: Trend chart */}
      <TimeRangePanel
        title="Success Rate Trend"
        queries={[successRateTrendsOptions]}
        skeleton={<div className="h-40" />}
      >
        {(data) => <SuccessRateMiniChart data={data} />}
      </TimeRangePanel>

      {/* Section 3: Detail lists */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <TimeRangePanel
          title="Repository Health"
          queries={[repositoriesOptions]}
          action={
            <Link
              to="/repos"
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              View all
            </Link>
          }
        >
          {(repositories) =>
            repositories.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No repositories found
              </p>
            ) : (
              <div className="space-y-3">
                {repositories.map((repo) => (
                  <div
                    key={repo.name}
                    className="flex items-center justify-between"
                  >
                    <div className="flex flex-col min-w-0 flex-1 mr-2">
                      <Link
                        to="/repos"
                        search={{
                          name: repo.name,
                        }}
                        className="text-sm font-medium hover:underline truncate"
                      >
                        {repo.name}
                      </Link>
                      <span className="text-muted-foreground text-xs">
                        {repo.totalRuns} runs
                      </span>
                    </div>
                    <Badge variant={getSuccessRateVariant(repo.successRate)}>
                      {repo.successRate}%
                    </Badge>
                  </div>
                ))}
              </div>
            )
          }
        </TimeRangePanel>

        <TimeRangePanel
          title="Top Failing Jobs"
          queries={[topFailingJobsOptions]}
        >
          {(jobs) =>
            jobs.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No failing jobs found
              </p>
            ) : (
              <div className="space-y-3">
                {jobs.map((job) => (
                  <div
                    key={`${job.repo}:${job.jobName}`}
                    className="flex items-center justify-between"
                  >
                    <div className="flex flex-col min-w-0 flex-1 mr-2">
                      <span className="text-sm font-medium truncate">
                        {job.jobName}
                      </span>
                      <span className="text-muted-foreground text-xs truncate">
                        {job.repo}
                      </span>
                    </div>
                    <Badge variant="destructive">{job.failureCount}x</Badge>
                  </div>
                ))}
              </div>
            )
          }
        </TimeRangePanel>

        <TimeRangePanel
          title="Top Failing Workflows"
          queries={[topFailingWorkflowsOptions]}
        >
          {(workflows) =>
            workflows.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No failing workflows found
              </p>
            ) : (
              <div className="space-y-3">
                {workflows.map((wf) => (
                  <Link
                    key={`${wf.repo}:${wf.workflowName}`}
                    to="/workflows/$repo/$workflowName"
                    params={{
                      repo: wf.repo,
                      workflowName: wf.workflowName,
                    }}
                    className="flex items-center justify-between hover:bg-muted/50 rounded-md px-1.5 py-1.5 transition-colors -mx-1.5"
                  >
                    <div
                      key={`${wf.repo}:${wf.workflowName}`}
                      className="flex items-center justify-between w-full"
                    >
                      <div className="flex flex-col min-w-0 flex-1 mr-2">
                        <span className="text-sm font-medium truncate">
                          {wf.workflowName}
                        </span>
                        <span className="text-muted-foreground text-xs truncate">
                          {wf.repo}
                        </span>
                      </div>
                      <Badge variant="destructive">{wf.failureCount}x</Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )
          }
        </TimeRangePanel>
      </div>

      {/* Section 4: Recent Runs */}
      <TimeRangePanel
        title="Recent Runs"
        queries={[latestRunsOptions]}
        action={
          <Link
            to="/runs"
            search={{
              page: 1,
              repos: [],
              branches: [],
              conclusions: [],
              workflowNames: [],
              runId: undefined,
            }}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            View all
          </Link>
        }
      >
        {(runs) =>
          runs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No runs found</p>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <Link
                  key={run.traceId}
                  to="/runs/$traceId"
                  params={{ traceId: run.traceId }}
                  className="hover:bg-muted/50 -mx-1.5 flex items-center justify-between rounded-md px-1.5 py-1.5 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <ConclusionIcon
                      conclusion={run.conclusion}
                      className="size-4 shrink-0"
                    />
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-sm font-medium truncate">
                        {run.workflowName}
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline">
                          <SiGithub data-icon="inline-start" />
                          {run.repo}
                        </Badge>
                        <Badge variant="outline">
                          <GitBranch data-icon="inline-start" />
                          {run.branch}
                        </Badge>
                        <Badge variant="outline">
                          <Hash data-icon="inline-start" />
                          {run.runId}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">
                      {formatRelativeTime(run.timestamp)}
                    </span>
                    <ChevronRight className="text-muted-foreground size-4" />
                  </div>
                </Link>
              ))}
            </div>
          )
        }
      </TimeRangePanel>
    </div>
  );
}
