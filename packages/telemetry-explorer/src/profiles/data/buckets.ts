import { normalizeTimestampToUtc } from "../../logs/util/timestamp";

/** Every bucket start of the range, so charts keep the gaps no row filled. */
export function bucketStarts(fromDate: Date, toDate: Date, intervalSeconds: number) {
  const intervalMs = intervalSeconds * 1000;
  const startMs = Math.floor(fromDate.getTime() / intervalMs) * intervalMs;
  const endMs = Math.floor(toDate.getTime() / intervalMs) * intervalMs;
  const buckets: { ms: number; timestamp: string; endTimestamp: string }[] = [];
  for (let ms = startMs; ms <= endMs; ms += intervalMs) {
    buckets.push({
      ms,
      timestamp: new Date(ms).toISOString(),
      endTimestamp: new Date(ms + intervalMs).toISOString(),
    });
  }
  return buckets;
}

/** A ClickHouse bucket timestamp as epoch milliseconds, to match `bucketStarts`. */
export function bucketMs(bucket: string): number {
  return new Date(normalizeTimestampToUtc(bucket)).getTime();
}
