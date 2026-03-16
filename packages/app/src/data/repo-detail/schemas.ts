import { z } from "zod";
import { TimeRangeSchema } from "@/lib/time-range";

const RepoDetailInputSchema = z.object({
  timeRange: TimeRangeSchema,
  repo: z.string(),
});
export { RepoDetailInputSchema };
export type RepoDetailInput = z.infer<typeof RepoDetailInputSchema>;

export interface RepoStats {
  totalRuns: number;
  successRate: number;
  avgDuration: number;
}

export interface RepoSuccessRatePoint {
  date: string;
  successRate: number;
  totalRuns: number;
  successCount: number;
  failureCount: number;
}

export interface RepoDurationPoint {
  date: string;
  p50Duration: number;
  p95Duration: number;
}

export interface RepoRecentRun {
  traceId: string;
  runId: string;
  workflowName: string;
  branch: string;
  conclusion: string;
  timestamp: string;
  sender: string;
}

export interface TopFailingJob {
  jobName: string;
  workflowName: string;
  totalRuns: number;
  failureCount: number;
  failureRate: number;
}

export interface ActiveBranch {
  branch: string;
  latestConclusion: string;
  latestTraceId: string;
  latestRunId: string;
  latestTimestamp: string;
  totalRuns: number;
  successRate: number;
}
