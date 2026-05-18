import { isValid } from "@everr/datemath";
import {
  formatTimeRangeDisplay,
  QUICK_RANGE_GROUPS,
} from "@everr/ui/components/time-range-picker";
import {
  DEFAULT_TIME_RANGE,
  resolveTimeRange,
  type TimeRange,
  TimeRangeSchema,
  toClickHouseDateTime,
} from "@everr/ui/lib/time-range";
import * as z from "zod";

export {
  DEFAULT_TIME_RANGE,
  formatTimeRangeDisplay,
  QUICK_RANGE_GROUPS,
  resolveTimeRange,
  type TimeRange,
  TimeRangeSchema,
  toClickHouseDateTime,
};

const datemath = z.string().refine(isValid);

export { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";

export type RefreshInterval = string;

export const TimeRangeSearchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  refresh: z.string().optional(),
});

export const ResolvedTimeRangeSearchSchema = z.object({
  from: datemath
    .catch(DEFAULT_TIME_RANGE.from)
    .default(DEFAULT_TIME_RANGE.from),
  to: datemath.catch(DEFAULT_TIME_RANGE.to).default(DEFAULT_TIME_RANGE.to),
  refresh: z.string().default(""),
});

export function withTimeRange<T extends { from?: string; to?: string }>(
  search: T,
): T & { from: string; to: string; timeRange: TimeRange } {
  const from = search.from ?? DEFAULT_TIME_RANGE.from;
  const to = search.to ?? DEFAULT_TIME_RANGE.to;
  return { ...search, from, to, timeRange: { from, to } };
}

export type BucketGranularity = "hour" | "day";

export function getBucketGranularity(
  fromDate: Date,
  toDate: Date,
): BucketGranularity {
  const hours = (toDate.getTime() - fromDate.getTime()) / 3_600_000;
  return hours <= 36 ? "hour" : "day";
}
