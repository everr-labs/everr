import { buttonVariants } from "@everr/ui/components/button";
import { Sparkline } from "@everr/ui/components/sparkline";
import { formatDuration } from "@everr/ui/lib/formatting";
import { cn } from "@everr/ui/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Coins,
  DollarSign,
  Receipt,
} from "lucide-react";
import { DeltaIndicator } from "@/components/delta-indicator";
import { RunsTable } from "@/components/runs-list/runs-table";
import { TimeRangePanel } from "@/components/time-range-panel";
import { CostByJobTable } from "@/components/workflows/cost-by-job-table";
import { WorkflowJobTimeline } from "@/components/workflows/run-gantt";
import type { TimeRangeInput } from "@/data/analytics/schemas";
import {
  workflowCostByJobOptions,
  workflowCostSummaryOptions,
  workflowRecentRunsOptions,
} from "@/data/workflows/options";
import { formatCost } from "@/lib/runner-pricing";
import { TimeRangeSearchSchema } from "@/lib/time-range";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/workflows/$repo/$workflowName",
)({
  staticData: {
    breadcrumb: (match: { params?: { workflowName?: string } }) => [
      { label: "Cost Analysis", to: "/cost-analysis" },
      {
        label: match.params?.workflowName
          ? decodeURIComponent(match.params.workflowName)
          : "Workflow",
      },
    ],
  },
  head: ({ params }) => ({
    meta: [{ title: `Everr - ${decodeURIComponent(params.workflowName)}` }],
  }),
  component: WorkflowCostDetailPage,
  validateSearch: TimeRangeSearchSchema,
});

function WorkflowCostDetailPage() {
  const { workflowName: rawName, repo: rawRepo } = Route.useParams();
  const workflowName = decodeURIComponent(rawName);
  const repo = decodeURIComponent(rawRepo);

  // Closures bind workflowName + repo so the panel passes only { timeRange }.
  const wfSummary = (tr: TimeRangeInput) =>
    workflowCostSummaryOptions({ ...tr, workflowName, repo });
  const wfByJob = (tr: TimeRangeInput) =>
    workflowCostByJobOptions({ ...tr, workflowName, repo });
  const wfRecentRuns = (tr: TimeRangeInput) =>
    workflowRecentRunsOptions({ ...tr, workflowName, repo });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <Link
            to="/cost-analysis"
            aria-label="Back to Cost Analysis"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              "mt-1 shrink-0 text-muted-foreground hover:text-foreground",
            )}
          >
            <ArrowLeft />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {workflowName}
            </h1>
            <p className="text-muted-foreground">{repo}</p>
          </div>
        </div>
        <Link
          to="/runs"
          search={{
            workflowNames: [workflowName],
            repos: [repo],
            branches: [],
            conclusions: [],
            runId: undefined,
          }}
          className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          View runs
          <ArrowRight className="size-4" />
        </Link>
      </div>

      {/* KPI stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TimeRangePanel
          title="Est. Cost"
          titleHint="Estimated from runner minutes. GitHub bills each job rounded up to the next whole minute; self-hosted runners are counted as $0."
          queries={[wfSummary]}
          variant="stat"
          icon={DollarSign}
          background={(s) =>
            s.overTime.some((v) => v > 0) ? (
              <Sparkline data={s.overTime} className="h-full w-full" />
            ) : null
          }
        >
          {(s) => (
            <>
              {formatCost(s.totalCost)}{" "}
              <DeltaIndicator
                current={s.totalCost}
                previous={s.prevTotalCost}
                invertColors
              />
              <p className="text-muted-foreground text-xs font-normal">
                {s.totalRuns.toLocaleString()} runs
              </p>
            </>
          )}
        </TimeRangePanel>

        <TimeRangePanel
          title="Avg $ / Run"
          queries={[wfSummary]}
          variant="stat"
          icon={Coins}
        >
          {(s) => formatCost(s.avgCostPerRun)}
        </TimeRangePanel>

        <TimeRangePanel
          title="Billed Minutes"
          titleHint="What GitHub charges for: each job's duration rounded up to the next whole minute, then summed. Always ≥ compute minutes."
          queries={[wfSummary]}
          variant="stat"
          icon={Receipt}
        >
          {(s) => s.billedMinutes.toLocaleString()}
        </TimeRangePanel>

        <TimeRangePanel
          title="Avg Wall-clock / Run"
          titleHint="Real elapsed time per run — what developers wait for. Jobs run in parallel, so this is below total compute minutes."
          queries={[wfSummary]}
          variant="stat"
          icon={Clock}
        >
          {(s) => (
            <>
              {s.avgWallClockMs > 0
                ? formatDuration(s.avgWallClockMs, "ms")
                : "—"}{" "}
              <DeltaIndicator
                current={s.avgWallClockMs}
                previous={s.prevAvgWallClockMs}
                invertColors
              />
            </>
          )}
        </TimeRangePanel>
      </div>

      {/* Job timeline (Gantt) — the hero: how parallel does this workflow run? */}
      <WorkflowJobTimeline workflowName={workflowName} repo={repo} />

      {/* Breakdown row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TimeRangePanel
          title="Cost by job"
          description="Where this workflow's budget goes"
          queries={[wfByJob]}
          inset="flush-content"
        >
          {(jobs) => <CostByJobTable data={jobs} />}
        </TimeRangePanel>

        <TimeRangePanel
          title="Recent runs"
          queries={[wfRecentRuns]}
          inset="flush-content"
        >
          {(runs) => <RunsTable data={runs} showCost />}
        </TimeRangePanel>
      </div>
    </div>
  );
}
