import { queryOptions } from "@tanstack/react-query";
import type { TimeRangeInput } from "@/data/analytics/schemas";
import {
  getUsageCurrentPeriod,
  getUsageForRange,
  getUsageHistory,
} from "./server";

export const usageForRangeOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["usage", "range", input],
    queryFn: () => getUsageForRange({ data: input }),
  });

export const usageCurrentPeriodOptions = () =>
  queryOptions({
    queryKey: ["usage", "current-period"],
    queryFn: () => getUsageCurrentPeriod(),
  });

export const usageHistoryOptions = () =>
  queryOptions({
    queryKey: ["usage", "history"],
    queryFn: () => getUsageHistory(),
  });
