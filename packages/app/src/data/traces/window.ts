import { parseTimestampAsUTC } from "@/lib/formatting";
import {
  DEFAULT_TIME_RANGE,
  resolveTimeRange,
  type TimeRange,
  toClickHouseDateTime,
} from "@/lib/time-range";

export type DetailWindow = { fromTs: string; toTs: string };

const HOUR_MS = 3_600_000;

export function computeDetailWindow(input: {
  start: string | undefined;
  end: string | undefined;
  timeRange: { from: string | undefined; to: string | undefined };
}): DetailWindow {
  if (input.start && input.end) {
    const fromTs = shiftCHDateTime(input.start, -HOUR_MS);
    const toTs = shiftCHDateTime(input.end, HOUR_MS);
    if (fromTs && toTs) return { fromTs, toTs };
  }
  const range: TimeRange = {
    from: input.timeRange.from || DEFAULT_TIME_RANGE.from,
    to: input.timeRange.to || DEFAULT_TIME_RANGE.to,
  };
  const { fromDate, toDate } = resolveTimeRange(range);
  return {
    fromTs: toClickHouseDateTime(fromDate),
    toTs: toClickHouseDateTime(toDate),
  };
}

export function addNsToCHDateTime(ts: string, ns: bigint): string {
  return shiftCHDateTime(ts, Number(ns / 1_000_000n)) ?? ts;
}

function shiftCHDateTime(ts: string, ms: number): string | undefined {
  const date = parseTimestampAsUTC(ts);
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return toClickHouseDateTime(new Date(date.getTime() + ms));
}
