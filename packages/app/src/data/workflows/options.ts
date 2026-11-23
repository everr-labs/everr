import { dataQueryOptions } from "@everr/ui/lib/query-options";
import { withViewerTimeRange } from "@everr/ui/lib/time-range";
import type { WorkflowDetailInput } from "./schemas";
import {
  getWorkflowCostByJob,
  getWorkflowCostSummary,
  getWorkflowRecentRuns,
  getWorkflowRunTimelines,
} from "./server";

export const workflowCostSummaryOptions = (input: WorkflowDetailInput) =>
  dataQueryOptions({
    queryKey: ["workflows", "costSummary", input],
    queryFn: () => getWorkflowCostSummary({ data: withViewerTimeRange(input) }),
  });

export const workflowCostByJobOptions = (input: WorkflowDetailInput) =>
  dataQueryOptions({
    queryKey: ["workflows", "costByJob", input],
    queryFn: () => getWorkflowCostByJob({ data: withViewerTimeRange(input) }),
  });

export const workflowRunTimelinesOptions = (input: WorkflowDetailInput) =>
  dataQueryOptions({
    queryKey: ["workflows", "runTimelines", input],
    queryFn: () => getWorkflowRunTimelines({ data: withViewerTimeRange(input) }),
  });

export const workflowRecentRunsOptions = (input: WorkflowDetailInput) =>
  dataQueryOptions({
    queryKey: ["workflows", "recentRuns", input],
    queryFn: () => getWorkflowRecentRuns({ data: withViewerTimeRange(input) }),
  });
