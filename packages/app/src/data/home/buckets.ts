import type { BucketGranularity } from "@/lib/time-range";

/**
 * Bucketing splits across two layers on purpose: `@/lib/time-range` decides
 * which granularity a range deserves, and each data module renders that
 * granularity into its own SQL and its own key grid. `cost-analysis/server.ts`
 * has the same shape. Choosing the granularity is a product rule shared by
 * every chart; emitting the keys is coupled to one module's column names and
 * row shapes, so it stays next to the queries that depend on it.
 */

/**
 * The bucket key a row falls into, as ClickHouse SQL.
 *
 * Both the rounding and the formatting are pinned to UTC. `Timestamp` and
 * `TimestampTime` carry no timezone, so on a server whose timezone is not UTC
 * these functions would round and format in local time while still writing a
 * literal `Z`. The keys would then miss every entry in `bucketGrid`, and each
 * series would come back fully zero-filled.
 */
export function bucketExpr(
  column: string,
  granularity: BucketGranularity,
): string {
  return granularity === "hour"
    ? `formatDateTime(toStartOfHour(${column}, 'UTC'), '%Y-%m-%dT%H:00:00Z', 'UTC')`
    : `formatDateTime(toStartOfDay(${column}, 'UTC'), '%Y-%m-%dT00:00:00Z', 'UTC')`;
}

/**
 * Every bucket key in the range, in order, so a series can be zero-filled
 * where the query returned no row at all. Keys match `bucketExpr` exactly.
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
