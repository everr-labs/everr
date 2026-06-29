import { TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";

// ── Types ───────────────────────────────────────────────────────────────

export interface WorkflowStats {
  totalRuns: number;
  successRate: number;
  avgDuration: number;
  p95Duration: number;
  prevTotalRuns: number;
  prevSuccessRate: number;
  prevAvgDuration: number;
}

export interface WorkflowTrendPoint {
  date: string;
  totalRuns: number;
  successRate: number;
  successCount: number;
  failureCount: number;
}

export interface WorkflowDurationTrendPoint {
  date: string;
  avgDuration: number;
  p95Duration: number;
}

export interface WorkflowFailingJob {
  jobName: string;
  failureCount: number;
  totalRuns: number;
  successRate: number;
}

export interface WorkflowFailureReason {
  pattern: string;
  count: number;
  lastOccurrence: string;
}

export interface WorkflowCost {
  totalCost: number;
  totalMinutes: number;
  prevTotalCost: number;
  overTime: number[];
}

// ── Input Schemas ───────────────────────────────────────────────────────

export const WorkflowDetailInputSchema = z.object({
  timeRange: TimeRangeSchema,
  workflowName: z.string(),
  repo: z.string(),
});
export type WorkflowDetailInput = z.infer<typeof WorkflowDetailInputSchema>;
