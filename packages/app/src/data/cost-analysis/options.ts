import { toAbsoluteTimeRange } from "@everr/ui/lib/time-range";
import { queryOptions } from "@tanstack/react-query";
import type { TimeRangeInput } from "#app/data/analytics/schemas.ts";
import { getCostByWorkflow, getCostOverTimeBreakdown, getCostOverview } from "./server";

// Query options factories
export const costOverviewOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["cost", "overview", input],
    queryFn: () =>
      getCostOverview({ data: { ...input, timeRange: toAbsoluteTimeRange(input.timeRange) } }),
  });

export const costByWorkflowOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["cost", "byWorkflow", input],
    queryFn: () =>
      getCostByWorkflow({ data: { ...input, timeRange: toAbsoluteTimeRange(input.timeRange) } }),
  });

export const costOverTimeBreakdownOptions = (
  input: TimeRangeInput & { dimension: "repo" | "runner" },
) =>
  // oxlint-disable-next-line query/exhaustive-deps -- DI repo / input already in key; not a real missing dep
  queryOptions({
    queryKey: ["cost", "overTimeBreakdown", input.timeRange, input.dimension],
    queryFn: () =>
      getCostOverTimeBreakdown({
        data: { ...input, timeRange: toAbsoluteTimeRange(input.timeRange) },
      }),
  });
