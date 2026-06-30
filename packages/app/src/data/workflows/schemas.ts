import { TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import type { RunListItem } from "../runs-list/schemas";

// ── Types ───────────────────────────────────────────────────────────────

/** One bucket of the cost-over-time series (spend in USD, compute minutes). */
export interface WorkflowCostOverTimePoint {
  date: string;
  spend: number;
  minutes: number;
}

/**
 * Cost-first summary for a single workflow over the selected range, plus the
 * previous period for deltas. Distinguishes three minute measures:
 *  - billedMinutes  — what GitHub charges (per-job duration ceil'd to the minute)
 *  - computeMinutes — actual elapsed runner time, summed across all jobs
 *  - wallClockMinutes — real elapsed time per run, summed (jobs run in parallel,
 *    so this is ≤ computeMinutes; the ratio is the parallelization factor)
 */
export interface WorkflowCostSummary {
  totalCost: number;
  prevTotalCost: number;
  avgCostPerRun: number;
  totalRuns: number;
  prevTotalRuns: number;
  billedMinutes: number;
  computeMinutes: number;
  wallClockMinutes: number;
  avgWallClockMs: number;
  prevAvgWallClockMs: number;
  avgJobsPerRun: number;
  selfHostedMinutes: number;
  overTime: WorkflowCostOverTimePoint[];
}

/** Cost attributed to one job (across all of its runs in the range). */
export interface WorkflowCostByJob {
  job: string;
  runs: number;
  computeMinutes: number;
  billedMinutes: number;
  estimatedCost: number;
}

/** A single job span positioned within its run's wall-clock window. */
export interface WorkflowRunGanttJob {
  jobId: string;
  name: string;
  conclusion: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  estimatedCost: number;
}

/** The most recent run, with its jobs laid out for a parallelization Gantt. */
export interface WorkflowRunGantt {
  runId: string;
  traceId: string;
  runAttempt: number;
  conclusion: string;
  timestamp: string;
  startMs: number;
  endMs: number;
  wallClockMs: number;
  computeMs: number;
  estimatedCost: number;
  jobs: WorkflowRunGanttJob[];
}

/** A recent run with its estimated cost attached. */
export interface WorkflowRunListItem extends RunListItem {
  estimatedCost: number;
}

// ── Input Schemas ───────────────────────────────────────────────────────

export const WorkflowDetailInputSchema = z.object({
  timeRange: TimeRangeSchema,
  workflowName: z.string(),
  repo: z.string(),
});
export type WorkflowDetailInput = z.infer<typeof WorkflowDetailInputSchema>;
