import { bucketSeconds, snapToNiceStep } from "@everr/ui/lib/bucket";
import { type TimeRange, toViewerTimeRange } from "@everr/ui/lib/time-range";

const SERIES_TARGET_BUCKETS = 120;
// A step the client sends can be finer than the range's own, but not by so
// much that a long range turns into a huge grid.
const SERIES_MAX_BUCKETS = 2 * SERIES_TARGET_BUCKETS;
// SDKs export every 60s by default. A finer step leaves most buckets empty,
// which breaks gauge lines into dots and counter rates into spikes.
export const SERIES_MIN_STEP_SECONDS = 60;

/**
 * The chart's step: about 120 buckets over the range, never under a minute,
 * and never finer than the metric's export interval (`minStep`), which would
 * only leave empty buckets between exports. The interval is rounded up to a
 * nice step, so buckets stay on round clock times, with 10% slack so 61 s
 * of exporter jitter stays at 1 minute. `fromExport` says the interval won.
 */
export function seriesStep(
  from: Date,
  to: Date,
  minStep?: number,
): { step: number; fromExport: boolean } {
  const byRange = Math.max(SERIES_MIN_STEP_SECONDS, bucketSeconds(from, to, SERIES_TARGET_BUCKETS));
  const byExport = minStep ? snapToNiceStep(minStep * 0.9) : 0;
  return { step: Math.max(byRange, byExport), fromExport: byExport > byRange };
}

/** The step a request asked for, kept coarse enough for its range. */
export function requestedStep(from: Date, to: Date, step: number): number {
  return Math.max(step, SERIES_MIN_STEP_SECONDS, bucketSeconds(from, to, SERIES_MAX_BUCKETS));
}

/**
 * When a chart's queries read the range: its step, the page's refresh epoch,
 * and for a relative range the step-long bucket `now` was in when the chart
 * last changed or refreshed. Queries with the same clock share one grid, so a
 * query that didn't change keeps its cached data while another loads, until
 * `now` moves into another bucket or the page refreshes.
 */
export type ChartClock = {
  step: number;
  fromExport: boolean;
  bucket: number | null;
  epoch: number;
};

export function chartClock(
  range: TimeRange,
  anchor: number,
  epoch: number,
  minStep?: number,
): ChartClock {
  const resolved = toViewerTimeRange(range, new Date(anchor));
  const { step, fromExport } = seriesStep(new Date(resolved.from), new Date(resolved.to), minStep);
  const relative = range.from.includes("now") || range.to.includes("now");
  return { step, fromExport, bucket: relative ? Math.floor(anchor / 1000 / step) : null, epoch };
}

/**
 * The instant a query reads the range at: the real `now`, kept within the
 * clock's bucket, so a query read later reads more of that bucket but never a
 * new one, which would leave it a bucket longer than the rest. The server
 * starts the buckets on the step's grid.
 */
export function clockNow(clock: ChartClock, now = Date.now()): Date {
  if (clock.bucket === null) return new Date(now);
  const stepMs = clock.step * 1000;
  return new Date(Math.min(Math.max(now, clock.bucket * stepMs), (clock.bucket + 1) * stepMs - 1));
}
