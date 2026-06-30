import { TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";

export interface RunListItem {
  traceId: string;
  runId: string;
  runAttempt: number;
  workflowName: string;
  repo: string;
  branch: string;
  conclusion: string;
  duration: number;
  /**
   * ISO start time when the run has started but not finished, so the UI can
   * show a live-ticking elapsed duration. `null` for completed runs (use
   * `duration`) and for runs that haven't started yet.
   */
  runningSince: string | null;
  timestamp: string;
  sender: string;
  displayTitle?: string | null;
  headSha?: string;
  jobCount?: number;
}

export interface RunsListResult {
  runs: RunListItem[];
  /** Omitted when the caller opts out of the count (later infinite pages). */
  totalCount: number | undefined;
}

// Shared across the list, infinite-scroll and histogram queries so they always
// filter on exactly the same fields.
const RunsFilterShape = {
  timeRange: TimeRangeSchema,
  repos: z.array(z.string()).optional(),
  branches: z.array(z.string()).optional(),
  conclusions: z
    .array(z.enum(["success", "failure", "cancellation"]))
    .optional(),
  workflowNames: z.array(z.string()).optional(),
  runId: z.string().optional(),
  authorEmails: z.array(z.string()).optional(),
};

export const RunsListInputSchema = z.object({
  ...RunsFilterShape,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  // Lets the infinite-scroll caller skip the count(*) past the first page.
  includeTotalCount: z.boolean().default(true),
});
export type RunsListInput = z.infer<typeof RunsListInputSchema>;

export const RunsHistogramInputSchema = z.object({
  ...RunsFilterShape,
  histogramBuckets: z.number().int().min(12).max(240).default(80),
});
export type RunsHistogramInput = z.infer<typeof RunsHistogramInputSchema>;

export interface RunHistogramBucket {
  timestamp: string;
  endTimestamp: string;
  total: number;
  success: number;
  failure: number;
  cancellation: number;
  other: number;
}

export interface FilterOptions {
  repos: string[];
  branches: string[];
  workflowNames: string[];
}

export const SearchRunsInputSchema = z.object({
  query: z.string().min(1),
});
