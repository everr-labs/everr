/**
 * Adaptive time bucketing. Panel queries get a server-computed `{step:UInt32}`
 * (seconds) so a time-series bucketed with
 * `toStartOfInterval(col, INTERVAL {step:UInt32} SECOND)` yields ~`targetPoints`
 * points at any range — fine detail when zoomed in, coarse buckets over weeks —
 * without the query hard-coding a resolution. Pure module (no I/O) for testing.
 */

/** Default bucket budget: a time-series query targets at most ~this many points. */
export const DEFAULT_TARGET_POINTS = 500;

// "Nice" bucket widths (seconds), ascending. Snapping the raw step up to one of
// these keeps `toStartOfInterval` boundaries on clean clock lines (e.g. :00/:30,
// hour, UTC day) so axis labels read well. Beyond the ladder we round up to a
// whole number of days.
const NICE_STEPS_SECONDS = [
  1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800,
  21600, 43200, 86400,
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

// ClickHouse datetimes are UTC, space-separated `YYYY-MM-DD HH:MM:SS[.mmm]`.
// Normalize to ISO-8601 and pin UTC so Date.parse doesn't read them as local.
function parseClickHouseDateTimeMs(value: string): number {
  const isoish = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(isoish)
    ? isoish
    : `${isoish}Z`;
  const ms = Date.parse(withZone);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Seconds-per-bucket for a resolved `[fromISO, toISO]` range, snapped to a nice
 * width, so a time-series query yields ~`targetPoints` buckets. Always >= 1.
 * Inputs are ClickHouse datetime strings (the output of `resolveTimeRange`).
 */
export function computeStepSeconds(
  fromISO: string,
  toISO: string,
  targetPoints: number = DEFAULT_TARGET_POINTS,
): number {
  const rangeSeconds = Math.max(
    0,
    (parseClickHouseDateTimeMs(toISO) - parseClickHouseDateTimeMs(fromISO)) /
      1000,
  );
  const points = Math.max(1, Math.floor(targetPoints));
  return snapToNiceStep(rangeSeconds / points);
}
