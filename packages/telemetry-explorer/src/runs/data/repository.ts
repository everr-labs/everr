import type {
  RunFilterOptions,
  RunHistogramBucket,
  RunsExplorerInput,
  RunsExplorerResult,
  RunsFilter,
  RunsHistogramInput,
} from "../schemas";

/**
 * Data source for the runs explorer. The web app implements this against
 * authenticated server functions, keeping transport details out of the UI.
 */
export interface RunsRepositoryLike {
  explorer(input: RunsExplorerInput): Promise<RunsExplorerResult>;
  histogram(input: RunsHistogramInput): Promise<RunHistogramBucket[]>;
  filterOptions(
    input: Pick<RunsFilter, "timeRange">,
  ): Promise<RunFilterOptions>;
}
