import type { BucketGranularity } from "@/lib/time-range";

/**
 * The bucket key a row falls into, as ClickHouse SQL.
 *
 * The rounding and the formatting both follow the server timezone.
 * `Timestamp` and `TimestampTime` carry no timezone, and `bucketGrid` builds
 * its keys in UTC, so every consumer assumes a ClickHouse server set to UTC.
 * On a server set to anything else the keys here would carry local time under
 * a literal `Z`, miss every entry in `bucketGrid`, and zero-fill each series.
 */
export function bucketExpr(
  column: string,
  granularity: BucketGranularity,
): string {
  return granularity === "hour"
    ? `formatDateTime(toStartOfHour(${column}), '%Y-%m-%dT%H:00:00Z')`
    : `formatDateTime(toStartOfDay(${column}), '%Y-%m-%dT00:00:00Z')`;
}

/**
 * Every bucket key in the range, in order, so a series can be zero-filled
 * where the query returned no row at all. Keys match `bucketExpr` on a
 * ClickHouse server set to UTC.
 */
export function bucketGrid(
  fromDate: Date,
  toDate: Date,
  granularity: BucketGranularity,
): string[] {
  const cursor = new Date(fromDate);
  cursor.setUTCMinutes(0, 0, 0);
  if (granularity === "day") cursor.setUTCHours(0);
  const buckets: string[] = [];
  while (cursor.getTime() <= toDate.getTime()) {
    buckets.push(`${cursor.toISOString().slice(0, 13)}:00:00Z`);
    if (granularity === "hour") {
      cursor.setUTCHours(cursor.getUTCHours() + 1);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return buckets;
}
