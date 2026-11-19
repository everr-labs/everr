import { toAbsoluteTimeRange } from "@everr/ui/lib/time-range";
import { queryOptions } from "@tanstack/react-query";
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
  queryOptions({
    queryKey: ["repo", "stats", input],
    queryFn: () =>
      getRepoStats({ data: { ...input, timeRange: toAbsoluteTimeRange(input.timeRange) } }),
  });

export const repoSuccessRateTrendOptions = (input: RepoDetailInput) =>
  queryOptions({
    queryKey: ["repo", "successRateTrend", input],
    queryFn: () =>
      getRepoSuccessRateTrend({
        data: { ...input, timeRange: toAbsoluteTimeRange(input.timeRange) },
      }),
  });

export const repoDurationTrendOptions = (input: RepoDetailInput) =>
  queryOptions({
    queryKey: ["repo", "durationTrend", input],
    queryFn: () =>
      getRepoDurationTrend({ data: { ...input, timeRange: toAbsoluteTimeRange(input.timeRange) } }),
  });

export const repoRecentRunsOptions = (input: RepoDetailInput) =>
  queryOptions({
    queryKey: ["repo", "recentRuns", input],
    queryFn: () =>
      getRepoRecentRuns({ data: { ...input, timeRange: toAbsoluteTimeRange(input.timeRange) } }),
  });

export const topFailingJobsOptions = (input: RepoDetailInput) =>
  queryOptions({
    queryKey: ["repo", "topFailingJobs", input],
    queryFn: () =>
      getTopFailingJobs({ data: { ...input, timeRange: toAbsoluteTimeRange(input.timeRange) } }),
  });

export const activeBranchesOptions = (input: RepoDetailInput) =>
  queryOptions({
    queryKey: ["repo", "activeBranches", input],
    queryFn: () =>
      getActiveBranches({ data: { ...input, timeRange: toAbsoluteTimeRange(input.timeRange) } }),
  });
