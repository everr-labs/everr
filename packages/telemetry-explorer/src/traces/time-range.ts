import { isValid } from "@everr/datemath";
import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import { z } from "zod";
import {
  DEFAULT_TIME_RANGE,
  resolveTimeRange,
  type TimeRange,
  TimeRangeSchema,
  toClickHouseDateTime,
} from "../time-range";

const datemath = z.string().refine(isValid);

export {
  DEFAULT_TIME_RANGE,
  getRefreshIntervalMs,
  resolveTimeRange,
  type TimeRange,
  TimeRangeSchema,
  toClickHouseDateTime,
};

export const TimeRangeSearchSchema = z.object({
  from: datemath.optional(),
  to: datemath.optional(),
  refresh: z.string().optional(),
});

export function withTimeRange<T extends { from?: string; to?: string }>(
  search: T,
): T & { from: string; to: string; timeRange: TimeRange } {
  const from = search.from ?? DEFAULT_TIME_RANGE.from;
  const to = search.to ?? DEFAULT_TIME_RANGE.to;
  return { ...search, from, to, timeRange: { from, to } };
}
