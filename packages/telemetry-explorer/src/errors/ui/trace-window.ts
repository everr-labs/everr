import { toClickHouseDateTime } from "@everr/ui/lib/time-range";
import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";

const TRACE_WINDOW_MS = 5 * 60 * 1000;

/**
 * ±5 minute ClickHouse window around an occurrence timestamp, used to scope the
 * related-trace lookup and the "open trace" link.
 */
export function getErrorTraceWindow(timestamp: string): {
  start: string;
  end: string;
} {
  const parsed = parseTimestampAsUTC(timestamp) ?? new Date();
  return {
    start: toClickHouseDateTime(new Date(parsed.getTime() - TRACE_WINDOW_MS)),
    end: toClickHouseDateTime(new Date(parsed.getTime() + TRACE_WINDOW_MS)),
  };
}
