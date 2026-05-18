import { queryOptions } from "@tanstack/react-query";
import type { TimeRangeInput } from "@/data/analytics/schemas";
import {
  getCostByWorkflow,
  getCostOverTimeBreakdown,
  getCostOverview,
} from "./server";

// Query options factories
export const costOverviewOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["cost", "overview", input],
    queryFn: () => getCostOverview({ data: input }),
  });

export const costByWorkflowOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["cost", "byWorkflow", input],
    queryFn: () => getCostByWorkflow({ data: input }),
  });

export const costOverTimeBreakdownOptions = (
  input: TimeRangeInput & { dimension: "repo" | "runner" },
) =>
  queryOptions({
    queryKey: ["cost", "overTimeBreakdown", input.timeRange, input.dimension],
    queryFn: () => getCostOverTimeBreakdown({ data: input }),
  });
