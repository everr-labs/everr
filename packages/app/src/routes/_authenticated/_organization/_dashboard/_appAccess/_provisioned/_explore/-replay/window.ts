import {
  DEFAULT_TIME_RANGE,
  resolveTimeRange,
  type TimeRange,
  toClickHouseDateTime,
} from "@everr/ui/lib/time-range";
import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";

export type DetailWindow = { fromTs: string; toTs: string };

const HOUR_MS = 3_600_000;

// The window the player queries for a Clip. The trace itself now loads by id
// with indexed timestamp bounds, so this window only scopes the recording
// spans and Segments.
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

export function windowAround(ts: string, padMs = HOUR_MS): DetailWindow {
  const fromTs = shiftCHDateTime(ts, -padMs);
  const toTs = shiftCHDateTime(ts, padMs);
  if (fromTs && toTs) return { fromTs, toTs };
  const { fromDate, toDate } = resolveTimeRange(DEFAULT_TIME_RANGE);
  return {
    fromTs: toClickHouseDateTime(fromDate),
    toTs: toClickHouseDateTime(toDate),
  };
}

function shiftCHDateTime(ts: string, ms: number): string | undefined {
  const date = parseTimestampAsUTC(ts);
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return toClickHouseDateTime(new Date(date.getTime() + ms));
}
