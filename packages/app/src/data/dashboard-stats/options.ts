import { queryOptions } from "@tanstack/react-query";
import type { TimeRangeInput } from "@/data/analytics/schemas";
import {
  getDashboardDurationStats,
  getDashboardStats,
  getRepositories,
  getTopFailingJobs,
  getTopFailingWorkflows,
} from "./server";

export const dashboardStatsOptions = ({ timeRange }: TimeRangeInput) =>
  queryOptions({
    queryKey: ["dashboard", "stats", timeRange],
    queryFn: () => getDashboardStats({ data: { timeRange } }),
  });

export const dashboardDurationStatsOptions = ({ timeRange }: TimeRangeInput) =>
  queryOptions({
    queryKey: ["dashboard", "durationStats", timeRange],
    queryFn: () => getDashboardDurationStats({ data: { timeRange } }),
  });

export const repositoriesOptions = ({ timeRange }: TimeRangeInput) =>
  queryOptions({
    queryKey: ["dashboard", "repositories", timeRange],
    queryFn: () => getRepositories({ data: { timeRange } }),
  });

export const topFailingJobsOptions = ({ timeRange }: TimeRangeInput) =>
  queryOptions({
    queryKey: ["dashboard", "topFailingJobs", timeRange],
    queryFn: () => getTopFailingJobs({ data: { timeRange } }),
  });

export const topFailingWorkflowsOptions = ({ timeRange }: TimeRangeInput) =>
  queryOptions({
    queryKey: ["dashboard", "topFailingWorkflows", timeRange],
    queryFn: () => getTopFailingWorkflows({ data: { timeRange } }),
  });
