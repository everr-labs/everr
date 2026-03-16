import { queryOptions } from "@tanstack/react-query";
import type { TimeRangeInput } from "./schemas";
import {
  getDurationTrends,
  getQueueTimeAnalysis,
  getRunnerUtilization,
  getSuccessRateTrends,
} from "./server";

export const durationTrendsOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["analytics", "durationTrends", input],
    queryFn: () => getDurationTrends({ data: input }),
  });

export const queueTimeAnalysisOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["analytics", "queueTime", input],
    queryFn: () => getQueueTimeAnalysis({ data: input }),
  });

export const successRateTrendsOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["analytics", "successRate", input],
    queryFn: () => getSuccessRateTrends({ data: input }),
  });

export const runnerUtilizationOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["analytics", "runnerUtilization", input],
    queryFn: () => getRunnerUtilization({ data: input }),
  });
