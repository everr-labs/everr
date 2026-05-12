import { isValid } from "@everr/datemath";
import {
  formatTimeRangeDisplay,
  QUICK_RANGE_GROUPS,
  QUICK_RANGES,
  type QuickRange,
  type QuickRangeGroup,
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
  QUICK_RANGES,
  type QuickRange,
  type QuickRangeGroup,
  resolveTimeRange,
  type TimeRange,
  TimeRangeSchema,
  toClickHouseDateTime,
};

const datemath = z.string().refine(isValid);

export {
  getRefreshIntervalMs,
  REFRESH_INTERVALS,
} from "@everr/ui/components/refresh-picker";

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

export { isValid as isValidDatemath };
