import { dataQueryOptions } from "@everr/ui/lib/query-options";
import { withViewerTimeRange } from "@everr/ui/lib/time-range";
import type { RepoDetailInput } from "./schemas";
import {
  getActiveBranches,
  getRepoDurationTrend,
  getRepoRecentRuns,
  getRepoStats,
  getRepoSuccessRateTrend,
  getTopFailingJobs,
} from "./server";

export const repoStatsOptions = (input: RepoDetailInput) =>
  dataQueryOptions({
    queryKey: ["repo", "stats", input],
    queryFn: () => getRepoStats({ data: withViewerTimeRange(input) }),
  });

export const repoSuccessRateTrendOptions = (input: RepoDetailInput) =>
  dataQueryOptions({
    queryKey: ["repo", "successRateTrend", input],
    queryFn: () => getRepoSuccessRateTrend({ data: withViewerTimeRange(input) }),
  });

export const repoDurationTrendOptions = (input: RepoDetailInput) =>
  dataQueryOptions({
    queryKey: ["repo", "durationTrend", input],
    queryFn: () => getRepoDurationTrend({ data: withViewerTimeRange(input) }),
  });

export const repoRecentRunsOptions = (input: RepoDetailInput) =>
  dataQueryOptions({
    queryKey: ["repo", "recentRuns", input],
    queryFn: () => getRepoRecentRuns({ data: withViewerTimeRange(input) }),
  });

export const topFailingJobsOptions = (input: RepoDetailInput) =>
  dataQueryOptions({
    queryKey: ["repo", "topFailingJobs", input],
    queryFn: () => getTopFailingJobs({ data: withViewerTimeRange(input) }),
  });

export const activeBranchesOptions = (input: RepoDetailInput) =>
  dataQueryOptions({
    queryKey: ["repo", "activeBranches", input],
    queryFn: () => getActiveBranches({ data: withViewerTimeRange(input) }),
  });
