import { toClickHouseDateTime } from "@everr/ui/lib/time-range";
import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";

export function addNsToCHDateTime(ts: string, ns: bigint): string {
  return shiftCHDateTime(ts, Number(ns / 1_000_000n)) ?? ts;
}

function shiftCHDateTime(ts: string, ms: number): string | undefined {
  const date = parseTimestampAsUTC(ts);
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return toClickHouseDateTime(new Date(date.getTime() + ms));
}
