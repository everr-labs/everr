import { queryOptions } from "@tanstack/react-query";
import type {
  WorkflowDetailInput,
  WorkflowsListInput,
  WorkflowsSparklineInput,
} from "./schemas";
import {
  getWorkflowCost,
  getWorkflowDurationTrend,
  getWorkflowFailureReasons,
  getWorkflowRecentRuns,
  getWorkflowStats,
  getWorkflowSuccessRateTrend,
  getWorkflowsList,
  getWorkflowsSparklines,
  getWorkflowTopFailingJobs,
} from "./server";

export const workflowsListOptions = (input: WorkflowsListInput) =>
  queryOptions({
    queryKey: ["workflows", "list", input],
    queryFn: () => getWorkflowsList({ data: input }),
  });

export const workflowsSparklineOptions = (input: WorkflowsSparklineInput) =>
  queryOptions({
    queryKey: ["workflows", "sparklines", input],
    queryFn: () => getWorkflowsSparklines({ data: input }),
    enabled: input.workflows.length > 0,
  });

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

export const workflowTopFailingJobsOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "topFailingJobs", input],
    queryFn: () => getWorkflowTopFailingJobs({ data: input }),
  });

export const workflowFailureReasonsOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "failureReasons", input],
    queryFn: () => getWorkflowFailureReasons({ data: input }),
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
