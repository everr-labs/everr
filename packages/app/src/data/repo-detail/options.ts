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
    queryFn: () => getRepoStats({ data: input }),
  });

export const repoSuccessRateTrendOptions = (input: RepoDetailInput) =>
  queryOptions({
    queryKey: ["repo", "successRateTrend", input],
    queryFn: () => getRepoSuccessRateTrend({ data: input }),
  });

export const repoDurationTrendOptions = (input: RepoDetailInput) =>
  queryOptions({
    queryKey: ["repo", "durationTrend", input],
    queryFn: () => getRepoDurationTrend({ data: input }),
  });

export const repoRecentRunsOptions = (input: RepoDetailInput) =>
  queryOptions({
    queryKey: ["repo", "recentRuns", input],
    queryFn: () => getRepoRecentRuns({ data: input }),
  });

export const topFailingJobsOptions = (input: RepoDetailInput) =>
  queryOptions({
    queryKey: ["repo", "topFailingJobs", input],
    queryFn: () => getTopFailingJobs({ data: input }),
  });

export const activeBranchesOptions = (input: RepoDetailInput) =>
  queryOptions({
    queryKey: ["repo", "activeBranches", input],
    queryFn: () => getActiveBranches({ data: input }),
  });
