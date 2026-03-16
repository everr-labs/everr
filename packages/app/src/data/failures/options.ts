import { queryOptions } from "@tanstack/react-query";
import type { TimeRangeInput } from "@/data/analytics/schemas";
import {
  getFailurePatterns,
  getFailuresByRepo,
  getFailureTrend,
} from "./server";

// Query options factories
export const failurePatternsOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["failures", "patterns", input],
    queryFn: () => getFailurePatterns({ data: input }),
  });

export const failureTrendOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["failures", "trend", input],
    queryFn: () => getFailureTrend({ data: input }),
  });

export const failuresByRepoOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["failures", "byRepo", input],
    queryFn: () => getFailuresByRepo({ data: input }),
  });
