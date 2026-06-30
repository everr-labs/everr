import type { TimeRange } from "@everr/ui/lib/time-range";

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
   * ISO start time when the run is actively in progress, so the UI can show a
   * live-ticking elapsed duration. `null` for completed runs (use `duration`)
   * and for runs that haven't started executing yet.
   */
  runningSince: string | null;
  timestamp: string;
  sender: string;
  displayTitle?: string | null;
  headSha?: string | null;
}

// The conclusions a user can filter by. Matches the server enum.
export const RUN_STATUS_FILTERS = [
  "success",
  "failure",
  "cancellation",
] as const;
export type RunStatusFilter = (typeof RUN_STATUS_FILTERS)[number];

/** Filters shared by the list, infinite-scroll, and histogram queries. */
export interface RunsFilter {
  timeRange: TimeRange;
  repos?: string[];
  branches?: string[];
  conclusions?: RunStatusFilter[];
  workflowNames?: string[];
  runId?: string;
  /**
   * When true, scope to the current user's own runs. The repository decides
   * what "mine" means (e.g. the desktop app matches author email); the explorer
   * just forwards the flag.
   */
  onlyMine?: boolean;
}

export interface RunsExplorerInput extends RunsFilter {
  limit: number;
  offset: number;
  /** Skip the count past the first infinite-scroll page. */
  includeTotalCount?: boolean;
}

export interface RunsExplorerResult {
  runs: RunListItem[];
  /** Omitted when the caller opts out of the count (later infinite pages). */
  totalCount?: number;
}

export interface RunsHistogramInput extends RunsFilter {
  histogramBuckets: number;
}

export interface RunHistogramBucket {
  timestamp: string;
  endTimestamp: string;
  total: number;
  success: number;
  failure: number;
  cancellation: number;
  other: number;
}

export interface RunFilterOptions {
  repos: string[];
  branches: string[];
  workflowNames: string[];
}

export const DEFAULT_RUNS_PAGE_SIZE = 50;
export const DEFAULT_RUNS_HISTOGRAM_BUCKETS = 80;
