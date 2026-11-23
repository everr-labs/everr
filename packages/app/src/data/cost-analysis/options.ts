import { dataQueryOptions } from "@everr/ui/lib/query-options";
import { viewerBucketWindow, withViewerTimeRange } from "@everr/ui/lib/time-range";
import type { TimeRangeInput } from "#app/data/analytics/schemas.ts";
import { getCostByWorkflow, getCostOverTimeBreakdown, getCostOverview } from "./server";

// Query options factories
export const costOverviewOptions = (input: TimeRangeInput) =>
  dataQueryOptions({
    queryKey: ["cost", "overview", input],
    queryFn: () => getCostOverview({ data: withViewerTimeRange(input) }),
  });

export const costByWorkflowOptions = (input: TimeRangeInput) =>
  dataQueryOptions({
    queryKey: ["cost", "byWorkflow", input],
    queryFn: () => getCostByWorkflow({ data: withViewerTimeRange(input) }),
  });

export const costOverTimeBreakdownOptions = (
  input: TimeRangeInput & { dimension: "repo" | "runner" },
) =>
  // oxlint-disable-next-line query/exhaustive-deps -- DI repo / input already in key; not a real missing dep
  dataQueryOptions({
    queryKey: ["cost", "overTimeBreakdown", input.timeRange, input.dimension],
    queryFn: () =>
      getCostOverTimeBreakdown({ data: { ...input, ...viewerBucketWindow(input.timeRange) } }),
  });
