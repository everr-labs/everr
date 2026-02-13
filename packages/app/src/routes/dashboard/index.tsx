import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ChevronRight } from "lucide-react";
import { ConclusionIcon } from "@/components/run-detail/conclusion-icon";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import {
  dashboardStatsOptions,
  recentActivityOptions,
  repositoriesOptions,
} from "@/data/dashboard-stats";
import { latestRunsOptions } from "@/data/runs";
import { formatRelativeTime, getSuccessRateVariant } from "@/lib/formatting";
import { TimeRangeSearchSchema } from "@/lib/time-range";

export const Route = createFileRoute("/dashboard/")({
  staticData: { breadcrumb: "Overview" },
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

      <Panel title="Job Runs" queries={[dashboardStatsOptions]} icon={Activity}>
        {(stats) => (
          <>
            <div className="text-2xl font-bold">{stats.totalJobRuns}</div>
            <div className="text-muted-foreground mt-1 flex gap-3 text-sm">
              <span className="text-green-600">
                {stats.successfulRuns} passed
              </span>
              <span className="text-red-600">{stats.failedRuns} failed</span>
              <span>{stats.successRate}% success rate</span>
            </div>
          </>
        )}
      </Panel>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel
          title="Watched Repositories"
          description="Repositories sending CI/CD telemetry"
          queries={[repositoriesOptions]}
        >
          {(repositories) =>
            repositories.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No repositories found. Set up a webhook to start collecting
                data.
              </p>
            ) : (
              <div className="space-y-3">
                {repositories.map((repo) => (
                  <div
                    key={repo.name}
                    className="flex items-center justify-between"
                  >
                    <div className="flex flex-col">
                      <Link
                        to="/dashboard/repos"
                        search={{
                          name: repo.name,
                          from: "now-7d",
                          to: "now",
                        }}
                        className="text-sm font-medium hover:underline"
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
        </Panel>

        <Panel title="Recent Activity" queries={[recentActivityOptions]}>
          {(recentActivity) =>
            recentActivity.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No recent activity
              </p>
            ) : (
              <div className="space-y-2">
                {recentActivity.map((day) => (
                  <div
                    key={day.date}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-muted-foreground">
                      {new Date(day.date).toLocaleDateString()}
                    </span>
                    <div className="flex gap-3">
                      <span className="text-green-600">
                        {day.successCount} passed
                      </span>
                      <span className="text-red-600">
                        {day.failureCount} failed
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </Panel>
      </div>

      <Panel
        title="Runs"
        description="Workflow executions in this period"
        queries={[latestRunsOptions]}
        action={
          <Link
            to="/dashboard/runs"
            search={{
              from: "now-7d",
              to: "now",
              page: 1,
              repo: undefined,
              branch: undefined,
              conclusion: undefined,
              workflowName: undefined,
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
                  to="/dashboard/runs/$traceId"
                  params={{ traceId: run.traceId }}
                  className="hover:bg-muted/50 -mx-1.5 flex items-center justify-between rounded-md px-1.5 py-1.5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <ConclusionIcon
                      conclusion={run.conclusion}
                      className="size-4"
                    />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        {run.workflowName}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {run.repo} • {run.branch}
                      </span>
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
      </Panel>
    </div>
  );
}
