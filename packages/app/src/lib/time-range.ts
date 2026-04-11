import { isValid, resolve } from "@everr/datemath";
import {
  DEFAULT_TIME_RANGE,
  formatTimeRangeDisplay,
  QUICK_RANGE_GROUPS,
  QUICK_RANGES,
  type QuickRange,
  type QuickRangeGroup,
  type TimeRange,
} from "@everr/ui/components/time-range-picker";
import { z } from "zod";

export {
  DEFAULT_TIME_RANGE,
  formatTimeRangeDisplay,
  QUICK_RANGE_GROUPS,
  QUICK_RANGES,
  type QuickRange,
  type QuickRangeGroup,
  type TimeRange,
};

const datemath = z.string().refine(isValid);

export const TimeRangeSchema = z.object({
  from: datemath.catch(DEFAULT_TIME_RANGE.from),
  to: datemath.catch(DEFAULT_TIME_RANGE.to),
});

export function toClickHouseDateTime(date: Date) {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

export function resolveTimeRange(range: TimeRange) {
  const fromDate = resolve(range.from, { roundUp: false });
  const toDate = resolve(range.to, { roundUp: true });
  return {
    fromDate,
    toDate,
    fromISO: toClickHouseDateTime(fromDate),
    toISO: toClickHouseDateTime(toDate),
  };
}

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
