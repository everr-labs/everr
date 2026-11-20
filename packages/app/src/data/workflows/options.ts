import { withViewerTimeRange } from "@everr/ui/lib/time-range";
import { queryOptions } from "@tanstack/react-query";
import type { WorkflowDetailInput } from "./schemas";
import {
  getWorkflowCostByJob,
  getWorkflowCostSummary,
  getWorkflowRecentRuns,
  getWorkflowRunTimelines,
} from "./server";

export const workflowCostSummaryOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "costSummary", input],
    queryFn: () => getWorkflowCostSummary({ data: withViewerTimeRange(input) }),
  });

export const workflowCostByJobOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "costByJob", input],
    queryFn: () => getWorkflowCostByJob({ data: withViewerTimeRange(input) }),
  });

export const workflowRunTimelinesOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "runTimelines", input],
    queryFn: () => getWorkflowRunTimelines({ data: withViewerTimeRange(input) }),
  });

export const workflowRecentRunsOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "recentRuns", input],
    queryFn: () => getWorkflowRecentRuns({ data: withViewerTimeRange(input) }),
  });
