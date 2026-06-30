import type {
  RunFilterOptions,
  RunHistogramBucket,
  RunsExplorerInput,
  RunsExplorerResult,
  RunsFilter,
  RunsHistogramInput,
} from "../schemas";

/**
 * Data source for the runs explorer. Each app implements this against its own
 * backend — the web app via authenticated server functions, the desktop app
 * via Tauri commands that hit Everr Cloud — so the UI stays identical across
 * surfaces.
 */
export interface RunsRepositoryLike {
  explorer(input: RunsExplorerInput): Promise<RunsExplorerResult>;
  histogram(input: RunsHistogramInput): Promise<RunHistogramBucket[]>;
  filterOptions(
    input: Pick<RunsFilter, "timeRange" | "onlyMine">,
  ): Promise<RunFilterOptions>;
}
