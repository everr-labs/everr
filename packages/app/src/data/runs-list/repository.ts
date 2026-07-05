import type { RunsRepositoryLike } from "@everr/telemetry-explorer/runs";
import { getRunFilterOptions, getRunsHistogram, getRunsList } from "./server";

/**
 * Web app implementation of the shared runs explorer data source, backed by the
 * authenticated server functions. The web shows all org runs, so `onlyMine` is
 * ignored.
 */
export const runsRepository: RunsRepositoryLike = {
  explorer: (input) =>
    getRunsList({
      data: {
        timeRange: input.timeRange,
        limit: input.limit,
        offset: input.offset,
        repos: input.repos,
        branches: input.branches,
        conclusions: input.conclusions,
        workflowNames: input.workflowNames,
        runId: input.runId,
        includeTotalCount: input.includeTotalCount,
      },
    }),
  histogram: (input) =>
    getRunsHistogram({
      data: {
        timeRange: input.timeRange,
        repos: input.repos,
        branches: input.branches,
        conclusions: input.conclusions,
        workflowNames: input.workflowNames,
        runId: input.runId,
        histogramBuckets: input.histogramBuckets,
      },
    }),
  filterOptions: (input) => getRunFilterOptions({ data: { timeRange: input.timeRange } }),
};
