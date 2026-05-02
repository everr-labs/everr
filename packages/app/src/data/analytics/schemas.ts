import { z } from "zod";
import { TimeRangeSchema } from "@/lib/time-range";

export const TimeRangeInputSchema = z.object({ timeRange: TimeRangeSchema });
export type TimeRangeInput = z.infer<typeof TimeRangeInputSchema>;

export interface DurationTrendPoint {
  date: string;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
  runCount: number;
}

export interface SuccessRatePoint {
  date: string;
  successRate: number;
  totalRuns: number;
  successCount: number;
  failureCount: number;
}
