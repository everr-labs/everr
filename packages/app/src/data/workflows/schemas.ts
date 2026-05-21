import { z } from "zod";
import { TimeRangeSchema } from "@/lib/time-range";

// ── Types ───────────────────────────────────────────────────────────────

export interface WorkflowListItem {
  workflowName: string;
  repo: string;
  totalRuns: number;
  successRate: number;
  avgDuration: number;
  lastRunAt: string;
  prevTotalRuns: number;
  prevSuccessRate: number;
  prevAvgDuration: number;
}

export interface WorkflowsListResult {
  workflows: WorkflowListItem[];
  totalCount: number;
}

export interface WorkflowSparklineBucket {
  date: string;
  totalRuns: number;
  successRate: number;
  avgDuration: number;
}

export interface WorkflowSparklineData {
  workflowName: string;
  repo: string;
  buckets: WorkflowSparklineBucket[];
}

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

export const WorkflowsListInputSchema = z.object({
  timeRange: TimeRangeSchema,
  page: z.coerce.number().int().min(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  repos: z.array(z.string()).optional(),
  search: z.string().optional(),
});
export type WorkflowsListInput = z.infer<typeof WorkflowsListInputSchema>;

export const WorkflowsSparklineInputSchema = z.object({
  timeRange: TimeRangeSchema,
  workflows: z.array(z.object({ workflowName: z.string(), repo: z.string() })),
});
export type WorkflowsSparklineInput = z.infer<
  typeof WorkflowsSparklineInputSchema
>;

export const WorkflowDetailInputSchema = z.object({
  timeRange: TimeRangeSchema,
  workflowName: z.string(),
  repo: z.string(),
});
export type WorkflowDetailInput = z.infer<typeof WorkflowDetailInputSchema>;
