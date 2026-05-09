import { isValid, resolve } from "@everr/datemath";
import {
  DEFAULT_TIME_RANGE,
  type TimeRange,
} from "@everr/ui/components/time-range-picker";
import { z } from "zod";

export type { TimeRange };
export { DEFAULT_TIME_RANGE };

const datemath = z.string().refine(isValid);

export const TimeRangeSchema = z.object({
  from: datemath.catch(DEFAULT_TIME_RANGE.from),
  to: datemath.catch(DEFAULT_TIME_RANGE.to),
});

export function toClickHouseDateTime(date: Date): string {
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
