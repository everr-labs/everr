import { resolve } from "@everr/datemath";
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
import type { TimeRange } from "@everr/ui/lib/time-range";
import { invokeCommand } from "@/lib/tauri";

function resolveToISO(expr: string, roundUp: boolean): string {
  return resolve(expr, { roundUp }).toISOString();
}

function resolveTimeRange(timeRange: TimeRange): { from: string; to: string } {
  return {
    from: resolveToISO(timeRange.from, false),
    to: resolveToISO(timeRange.to, true),
  };
}

/**
 * Desktop runs explorer data source. Each method forwards to the matching Tauri
 * command (which hits Everr Cloud), converting the datemath time range to ISO
 * timestamps and defaulting `onlyMine` to false when unset.
 */
export const ciRunsRepository: RunsRepositoryLike = {
  async explorer(input: RunsExplorerInput): Promise<RunsExplorerResult> {
    const result = await invokeCommand<{
      runs: RunListItem[];
      totalCount: number | null;
    }>("get_runs_list", {
      ...resolveTimeRange(input.timeRange),
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
      ...resolveTimeRange(input.timeRange),
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
    input: Pick<RunsFilter, "timeRange" | "onlyMine">,
  ): Promise<RunFilterOptions> {
    return invokeCommand<RunFilterOptions>("get_run_filter_options", {
      ...resolveTimeRange(input.timeRange),
      onlyMine: input.onlyMine ?? false,
    });
  },
};
