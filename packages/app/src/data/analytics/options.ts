import { queryOptions } from "@tanstack/react-query";
import type { TimeRangeInput } from "./schemas";
import { getDurationTrends, getSuccessRateTrends } from "./server";

export const durationTrendsOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["analytics", "durationTrends", input],
    queryFn: () => getDurationTrends({ data: input }),
  });

export const successRateTrendsOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["analytics", "successRate", input],
    queryFn: () => getSuccessRateTrends({ data: input }),
  });
