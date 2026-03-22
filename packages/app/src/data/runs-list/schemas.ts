import { z } from "zod";
import { TimeRangeSchema } from "@/lib/time-range";

export interface RunListItem {
  traceId: string;
  runId: string;
  runAttempt: number;
  workflowName: string;
  repo: string;
  branch: string;
  conclusion: string;
  duration: number;
  timestamp: string;
  sender: string;
  headSha?: string;
  jobCount?: number;
}

export interface RunsListResult {
  runs: RunListItem[];
  totalCount: number;
}

export const RunsListInputSchema = z.object({
  timeRange: TimeRangeSchema,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  repo: z.string().optional(),
  branch: z.string().optional(),
  conclusion: z.enum(["success", "failure", "cancellation"]).optional(),
  workflowName: z.string().optional(),
  runId: z.string().optional(),
});
export type RunsListInput = z.infer<typeof RunsListInputSchema>;

export interface FilterOptions {
  repos: string[];
  branches: string[];
  workflowNames: string[];
}

export interface RunSearchResult {
  traceId: string;
  runId: string;
  workflowName: string;
  repo: string;
  branch: string;
  conclusion: string;
  timestamp: string;
}

export const SearchRunsInputSchema = z.object({
  query: z.string().min(1),
});
