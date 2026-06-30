import { TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import type { RunListItem } from "../runs-list/schemas";

// ── Types ───────────────────────────────────────────────────────────────

/**
 * Cost-first summary for a single workflow over the selected range, plus the
 * previous period for deltas.
 *  - billedMinutes — what GitHub charges (per-job duration ceil'd to the minute)
 *  - avgWallClockMs — real elapsed time per run (jobs run in parallel)
 *  - overTime — daily estimated spend, oldest→newest, for the sparkline
 */
export interface WorkflowCostSummary {
  totalCost: number;
  prevTotalCost: number;
  avgCostPerRun: number;
  totalRuns: number;
  billedMinutes: number;
  avgWallClockMs: number;
  prevAvgWallClockMs: number;
  overTime: number[];
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

/** A run with its jobs laid out for a parallelization Gantt. */
export interface WorkflowRunGantt {
  runId: string;
  traceId: string;
  runAttempt: number;
  conclusion: string;
  timestamp: string;
  startMs: number;
  wallClockMs: number;
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
