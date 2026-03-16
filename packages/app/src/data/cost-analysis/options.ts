import { queryOptions } from "@tanstack/react-query";
import type { TimeRangeInput } from "@/data/analytics/schemas";
import { getCostByRepo, getCostByWorkflow, getCostOverview } from "./server";

// Query options factories
export const costOverviewOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["cost", "overview", input],
    queryFn: () => getCostOverview({ data: input }),
  });

export const costByRepoOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["cost", "byRepo", input],
    queryFn: () => getCostByRepo({ data: input }),
  });

export const costByWorkflowOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["cost", "byWorkflow", input],
    queryFn: () => getCostByWorkflow({ data: input }),
  });
