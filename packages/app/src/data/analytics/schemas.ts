import { z } from "zod";
import { TimeRangeSchema } from "@/lib/time-range";

export { TimeRangeSchema };

export const TimeRangeInputSchema = z.object({ timeRange: TimeRangeSchema });
export type TimeRangeInput = z.infer<typeof TimeRangeInputSchema>;

export interface DurationTrendPoint {
  date: string;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
  runCount: number;
}

export interface QueueTimePoint {
  date: string;
  avgQueueTime: number;
  p50QueueTime: number;
  p95QueueTime: number;
  maxQueueTime: number;
}

export interface SuccessRatePoint {
  date: string;
  successRate: number;
  totalRuns: number;
  successCount: number;
  failureCount: number;
}

export interface RunnerUtilization {
  labels: string;
  totalJobs: number;
  avgDuration: number;
  successRate: number;
  totalDuration: number;
}
