import { z } from "zod";
import { TimeRangeSchema } from "@/lib/time-range";

export const LogLevelSchema = z.enum([
  "error",
  "warning",
  "info",
  "debug",
  "trace",
  "unknown",
]);

export type LogLevel = z.infer<typeof LogLevelSchema>;

export const LogsExplorerInputSchema = z.object({
  timeRange: TimeRangeSchema,
  query: z.string().trim().optional(),
  levels: z.array(LogLevelSchema).default([]),
  services: z.array(z.string()).default([]),
  repos: z.array(z.string()).default([]),
  traceId: z.string().trim().optional(),
  limit: z.number().int().min(1).max(500).default(200),
  offset: z.number().int().min(0).default(0),
  includeSummary: z.boolean().default(true),
});

export type LogsExplorerInput = z.infer<typeof LogsExplorerInputSchema>;

export interface LogExplorerRow {
  id: string;
  timestamp: string;
  serviceName: string;
  level: LogLevel;
  severityText: string;
  severityNumber: number;
  body: string;
  traceId: string;
  spanId: string;
  repo: string;
  branch: string;
  workflowName: string;
  runId: string;
  jobId: string;
  jobName: string;
  stepNumber: string;
}

export interface LogHistogramBucket {
  timestamp: string;
  timeLabel: string;
  total: number;
  error: number;
  warning: number;
  info: number;
  debug: number;
  trace: number;
  unknown: number;
}

export interface LogsExplorerResult {
  logs: LogExplorerRow[];
  totalCount: number;
  histogram: LogHistogramBucket[];
  levelCounts: Record<LogLevel, number>;
}

export interface LogFilterOptions {
  services: string[];
  repos: string[];
}
