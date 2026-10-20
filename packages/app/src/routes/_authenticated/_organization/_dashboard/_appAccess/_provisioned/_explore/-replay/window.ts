import {
  DEFAULT_TIME_RANGE,
  resolveTimeRange,
  toClickHouseDateTime,
} from "@everr/ui/lib/time-range";
import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";

export type DetailWindow = { fromTs: string; toTs: string };

const HOUR_MS = 3_600_000;

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
