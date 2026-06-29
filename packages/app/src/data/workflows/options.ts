import { queryOptions } from "@tanstack/react-query";
import type { WorkflowDetailInput } from "./schemas";
import {
  getWorkflowCost,
  getWorkflowDurationTrend,
  getWorkflowRecentRuns,
  getWorkflowStats,
  getWorkflowSuccessRateTrend,
} from "./server";

export const workflowStatsOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "stats", input],
    queryFn: () => getWorkflowStats({ data: input }),
  });

export const workflowSuccessRateTrendOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "successRateTrend", input],
    queryFn: () => getWorkflowSuccessRateTrend({ data: input }),
  });

export const workflowDurationTrendOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "durationTrend", input],
    queryFn: () => getWorkflowDurationTrend({ data: input }),
  });

export const workflowCostOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "cost", input],
    queryFn: () => getWorkflowCost({ data: input }),
  });

export const workflowRecentRunsOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "recentRuns", input],
    queryFn: () => getWorkflowRecentRuns({ data: input }),
  });
