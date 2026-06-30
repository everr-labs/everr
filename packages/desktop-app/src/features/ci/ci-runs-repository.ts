import type {
  RunFilterOptions,
  RunHistogramBucket,
  RunListItem,
  RunsExplorerInput,
  RunsExplorerResult,
  RunsFilter,
  RunsHistogramInput,
  RunsRepositoryLike,
} from "@everr/telemetry-explorer/runs";
import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import { invokeCommand } from "@/lib/tauri";

// Resolve the datemath range to ISO timestamps for the Tauri commands, reusing
// the shared round convention (from rounds down, to rounds up).
function toCommandRange(timeRange: TimeRange): { from: string; to: string } {
  const { fromDate, toDate } = resolveTimeRange(timeRange);
  return { from: fromDate.toISOString(), to: toDate.toISOString() };
}

/**
 * Desktop runs explorer data source. Each method forwards to the matching Tauri
 * command (which hits Everr Cloud), defaulting `onlyMine` to false when unset.
 */
export const ciRunsRepository: RunsRepositoryLike = {
  async explorer(input: RunsExplorerInput): Promise<RunsExplorerResult> {
    const result = await invokeCommand<{
      runs: RunListItem[];
      totalCount: number | null;
    }>("get_runs_list", {
      ...toCommandRange(input.timeRange),
      limit: input.limit,
      offset: input.offset,
      repos: input.repos,
      branches: input.branches,
      conclusions: input.conclusions,
      workflowNames: input.workflowNames,
      runId: input.runId,
      onlyMine: input.onlyMine ?? false,
      includeTotalCount: input.includeTotalCount,
    });
    // Rust serializes Option::None as null; the explorer footer expects undefined.
    return { runs: result.runs, totalCount: result.totalCount ?? undefined };
  },

  histogram(input: RunsHistogramInput): Promise<RunHistogramBucket[]> {
    return invokeCommand<RunHistogramBucket[]>("get_runs_histogram", {
      ...toCommandRange(input.timeRange),
      repos: input.repos,
      branches: input.branches,
      conclusions: input.conclusions,
      workflowNames: input.workflowNames,
      runId: input.runId,
      onlyMine: input.onlyMine ?? false,
      histogramBuckets: input.histogramBuckets,
    });
  },

  filterOptions(
    input: Pick<RunsFilter, "timeRange">,
  ): Promise<RunFilterOptions> {
    return invokeCommand<RunFilterOptions>("get_run_filter_options", {
      ...toCommandRange(input.timeRange),
    });
  },
};
