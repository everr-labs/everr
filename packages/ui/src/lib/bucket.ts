/**
 * Adaptive time bucketing, shared across the dashboards panel `{step}` parameter
 * and the logs histogram. Given a range and a target bucket count, returns a
 * bucket width in seconds snapped to a "nice" clock-aligned value, so a series
 * bucketed with `toStartOfInterval(col, INTERVAL <n> SECOND)` keeps a roughly
 * bounded point count at any zoom and its boundaries land on clean clock lines
 * (`:00`/`:30`, the hour, the day; see `bucketStartMs` for the viewer's
 * clock). Pure module (no I/O).
 */

import { z } from "zod";
import { resolveTimeRange, type TimeRange, toViewerTimeRange } from "./time-range";

// "Nice" bucket widths (seconds), ascending. Snapping the raw width up to one of
// these keeps `toStartOfInterval` boundaries on clean clock lines. Beyond the
// ladder we round up to a whole number of days.
const NICE_STEPS_SECONDS = [
  1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400,
] as const;
const DAY_SECONDS = 86400;

/** Smallest nice step >= `seconds` (>= 1s); rounds up to whole days past 1d. */
export function snapToNiceStep(seconds: number): number {
  const s = Math.max(1, Math.ceil(seconds));
  for (const step of NICE_STEPS_SECONDS) {
    if (step >= s) return step;
  }
  return Math.ceil(s / DAY_SECONDS) * DAY_SECONDS;
}

/**
 * Seconds-per-bucket for the range `[from, to]`, snapped to a nice width so the
 * range yields ~`targetBuckets` buckets. Always >= 1; a zero or negative range
 * floors to 1 second.
 */
export function bucketSeconds(from: Date, to: Date, targetBuckets: number): number {
  const rangeSeconds = (to.getTime() - from.getTime()) / 1000;
  const target = Math.max(1, Math.floor(targetBuckets));
  return snapToNiceStep(rangeSeconds / target);
}

/** A UTC offset in minutes, east positive (New York in winter: -300). Offsets
 *  in use run from UTC-12 to UTC+14. */
export const UtcOffsetMinutesSchema = z
  .number()
  .int()
  .min(-14 * 60)
  .max(14 * 60);

/**
 * A histogram's window in the viewer's zone, plus the viewer's offset at its
 * end so its bars start on the viewer's clock. Call it in `queryFn`.
 */
export function viewerHistogramWindow(range: TimeRange) {
  const timeRange = toViewerTimeRange(range);
  const { toDate } = resolveTimeRange(timeRange);
  return { timeRange, utcOffsetMinutes: -toDate.getTimezoneOffset() };
}

/**
 * Start of the bucket holding `ms`, with bucket edges on the clock of a zone
 * `utcOffsetMinutes` from UTC: a day bucket starts at that zone's midnight and
 * an hour bucket on its hour. The SQL that buckets rows shifts by the same
 * offset, so the two always agree. A fixed offset drifts by an hour across a
 * DST change inside the range, which only moves bars of an hour or wider.
 */
export function bucketStartMs(ms: number, intervalSeconds: number, utcOffsetMinutes: number) {
  const intervalMs = intervalSeconds * 1000;
  const offsetMs = utcOffsetMinutes * 60_000;
  return Math.floor((ms + offsetMs) / intervalMs) * intervalMs - offsetMs;
}
