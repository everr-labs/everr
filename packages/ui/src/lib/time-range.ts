import { isValid, resolve } from "@everr/datemath";
import { z } from "zod";

export interface TimeRange {
  from: string;
  to: string;
}

export const DEFAULT_TIME_RANGE: TimeRange = {
  from: "now-7d",
  to: "now",
} as const;

const datemath = z.string().refine(isValid);

export const TimeRangeSchema = z.object({
  from: datemath.catch(DEFAULT_TIME_RANGE.from),
  to: datemath.catch(DEFAULT_TIME_RANGE.to),
});

export function toClickHouseDateTime(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * A whole-second literal. A DateTime column refuses a fractional part in a
 * comparison, even `.000`, and a DateTime64 column reads this form the same
 * way. `floor` keeps a window's start inside the range, `ceil` keeps its end.
 */
export function toClickHouseDateTimeSeconds(
  date: Date,
  round: "floor" | "ceil",
): string {
  const seconds = Math[round](date.getTime() / 1000);
  return toClickHouseDateTime(new Date(seconds * 1000)).slice(0, 19);
}

export function withTimeRange<T extends { from?: string; to?: string }>(
  search: T,
): T & { from: string; to: string; timeRange: TimeRange } {
  const from = search.from ?? DEFAULT_TIME_RANGE.from;
  const to = search.to ?? DEFAULT_TIME_RANGE.to;
  return { ...search, from, to, timeRange: { from, to } };
}

export function resolveTimeRange(range: TimeRange, now = new Date()) {
  const fromDate = resolve(range.from, { now, roundUp: false });
  const toDate = resolve(range.to, { now, roundUp: true });
  return {
    fromDate,
    toDate,
    fromISO: toClickHouseDateTime(fromDate),
    toISO: toClickHouseDateTime(toDate),
  };
}

export function isValidTimeRange(range: TimeRange, now = new Date()): boolean {
  try {
    const { fromDate, toDate } = resolveTimeRange(range, now);
    return fromDate < toDate;
  } catch {
    return false;
  }
}
