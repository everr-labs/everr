import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import { isNumericValue, toNumber } from "#app/lib/numeric.ts";
import type { QueryResultRow } from "./index";

export { toNumber };

/** Shared series palette. Index 0 doubles as the accent color for brush
 * selections and sparklines. */
export const SERIES_COLORS = [
  "hsl(263, 90%, 65%)",
  "hsl(56, 90%, 65%)",
  "hsl(195, 90%, 65%)",
  "hsl(27, 90%, 65%)",
  "hsl(215, 90%, 65%)",
  "hsl(126, 90%, 65%)",
  "hsl(167, 90%, 65%)",
  "hsl(356, 90%, 65%)",
  "hsl(185, 90%, 65%)",
  "hsl(311, 90%, 65%)",
];

/** Clean clock intervals a time axis may tick at, ascending. */
const TICK_INTERVALS = [
  1_000,
  5_000,
  10_000,
  30_000,
  60_000,
  5 * 60_000,
  10 * 60_000,
  30 * 60_000,
  3_600_000,
  3 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
  86_400_000,
  2 * 86_400_000,
  3 * 86_400_000,
  7 * 86_400_000,
  14 * 86_400_000,
  30 * 86_400_000,
  90 * 86_400_000,
  365 * 86_400_000,
];

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** The interval `generateTimeTicks` ticks `domain` at. */
export function timeTickInterval(domain: [number, number], maxTicks: number): number {
  const ideal = (domain[1] - domain[0]) / maxTicks;
  return TICK_INTERVALS.find((i) => i >= ideal) ?? TICK_INTERVALS.at(-1) ?? 1_000;
}

/**
 * Tick positions across a time domain, at most about maxTicks of them, on
 * the local clock: whole local hours, local midnights, first days of months.
 * Ticks of an hour or more step through the local calendar rather than by a
 * fixed number of milliseconds, so they stay on the clock across a DST change.
 */
export function generateTimeTicks(domain: [number, number], maxTicks: number): number[] {
  const [start, end] = domain;
  if (end <= start) return [];
  const interval = timeTickInterval(domain, maxTicks);
  const ticks: number[] = [];

  if (interval < HOUR) {
    // Every zone offset is a whole number of these, give or take 45-minute
    // zones, so UTC multiples are local ones too.
    for (let t = Math.ceil(start / interval) * interval; t <= end; t += interval) ticks.push(t);
    return ticks;
  }

  const at = new Date(start);
  if (interval < DAY) {
    const hours = interval / HOUR;
    at.setMinutes(0, 0, 0);
    if (at.getTime() < start) at.setHours(at.getHours() + 1);
    for (; at.getTime() <= end; at.setHours(at.getHours() + 1)) {
      if (at.getHours() % hours === 0) ticks.push(at.getTime());
    }
    return ticks;
  }

  at.setHours(0, 0, 0, 0);
  if (at.getTime() < start) at.setDate(at.getDate() + 1);
  const days = interval / DAY;
  const months = days >= 365 ? 12 : days >= 90 ? 3 : days >= 30 ? 1 : 0;
  for (; at.getTime() <= end; at.setDate(at.getDate() + 1)) {
    const keep = months
      ? at.getDate() === 1 && at.getMonth() % months === 0
      : // Days since the epoch in local time, so the step does not drift
        // with where the range starts.
        Math.round(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) / DAY) % days === 0;
    if (keep) ticks.push(at.getTime());
  }
  return ticks;
}

/** A step of 1, 2, 2.5 or 5 times a power of ten, at least as large as `raw`. */
function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const f = raw / magnitude;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return m * magnitude;
}

/**
 * A value axis stated outright: round bounds, round ticks, and the numbers
 * available to the caller.
 *
 * The cursor and hover highlight use the same bounds as the rendered axis.
 * Round steps stay at 1, 2, 2.5 and 5 times a power of ten. An automatic
 * range leaves room around the data. Explicit bounds stay exact and may clip
 * data outside the configured range.
 *
 * `divisor` is what the axis labels divide values by (1024³ for GiB): steps
 * are chosen round in that displayed unit, not in the raw values.
 */
export function niceLinearDomain(
  min: number,
  max: number,
  tickCount = 5,
  options: { min?: number; max?: number; divisor?: number } = {},
): { domain: [number, number]; ticks: number[] } {
  const { divisor = 1, ...bounds } = options;
  const dataMin = Number.isFinite(min) ? min : 0;
  const dataMax = Number.isFinite(max) ? max : 0;
  const span = Math.max(0, dataMax - dataMin);
  const flatZero = dataMin === 0 && dataMax === 0;
  const padding = span > 0 ? span * 0.1 : flatZero ? 1 : Math.abs(dataMin) * 0.1;
  let lo0 =
    bounds.min !== undefined
      ? bounds.min
      : flatZero
        ? -padding
        : dataMin >= 0
          ? Math.max(0, dataMin - padding)
          : dataMin - padding;
  let hi0 =
    bounds.max !== undefined
      ? bounds.max
      : flatZero
        ? padding
        : dataMax <= 0
          ? Math.min(0, dataMax + padding)
          : dataMax + padding;
  // A single fixed bound determines one edge. Fit the other to the data
  // without adding a second padding term; round it to a readable tick below.
  if (bounds.min !== undefined && bounds.max === undefined) hi0 = dataMax;
  if (bounds.max !== undefined && bounds.min === undefined) lo0 = dataMin;
  if (hi0 <= lo0) {
    const fallbackSpan = Math.max(Math.abs(lo0 || hi0) * 0.1, 1);
    if (bounds.min !== undefined) hi0 = lo0 + fallbackSpan;
    else lo0 = hi0 - fallbackSpan;
  }
  // A flat series still needs an axis with height, or it plots on the edge.
  const step = niceStep(Math.max(hi0 - lo0, Number.EPSILON) / (tickCount - 1) / divisor) * divisor;
  const lo = bounds.min ?? Math.floor(lo0 / step) * step;
  const hi = bounds.max ?? Math.ceil(hi0 / step) * step;
  const ticks: number[] = [];
  // Rounded per tick: repeated addition of a step like 0.2 accumulates binary
  // error into labels such as "0.6000000000000001".
  if (bounds.min !== undefined || bounds.max !== undefined) {
    ticks.push(lo);
    const first = Math.ceil(lo / step) * step;
    for (let tick = first; tick < hi;) {
      if (tick > lo) ticks.push(Number(tick.toPrecision(12)));
      const next = tick + step;
      // At large magnitudes the step can be smaller than floating-point
      // precision, so adding it may leave the tick unchanged.
      if (next <= tick) break;
      tick = next;
    }
    ticks.push(hi);
  } else {
    for (let i = 0; lo + i * step <= hi + step / 2; i++) {
      ticks.push(Number((lo + i * step).toPrecision(12)));
    }
  }
  return { domain: [lo, hi === lo ? lo + step : hi], ticks };
}

const QUERY_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Display name for a panel query by index: "Query A", "Query B", … */
export function queryLabel(index: number): string {
  return `Query ${QUERY_LETTERS[index] ?? index + 1}`;
}

/**
 * The time-axis column, detected by EXACT name (case-insensitive). A prefix
 * match would claim columns like `timezone` or `timestamp_label` as the time
 * axis and silently poison the chart, so queries must alias their time column
 * to one of these names. Keep the docs' list in sync.
 */
export function detectTimeKey(rows: QueryResultRow[]): string | undefined {
  const first = rows[0];
  if (!first) return undefined;

  const timeNames = /^(ts|time|timestamp)$/i;
  for (const key of Object.keys(first)) {
    if (timeNames.test(key)) return key;
  }
  return undefined;
}

/**
 * Value (numeric) columns across the whole result set. A column counts as a
 * value column if it is numeric in *any* row — not just the first. ClickHouse
 * commonly returns NULL for the leading bucket(s) of an aggregate (no events
 * yet), so a first-row-only check would drop a perfectly good metric and leave
 * stat cards blank / time-series series missing.
 */
export function getValueKeys(rows: QueryResultRow[], timeKey: string): string[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).filter(
    (k) => k !== timeKey && rows.some((row) => isNumericValue(row[k])),
  );
}

/**
 * Grouping-dimension columns. A column is a grouping dimension if it carries
 * non-numeric string content in *any* row. A string that parses as a number
 * (e.g. a quoted ClickHouse aggregate) is a value, not a dimension — exclude
 * it so it isn't double-counted. Scanning all rows mirrors getValueKeys: the
 * leading bucket may be NULL for a dimension that is populated later.
 */
export function getGroupKeys(rows: QueryResultRow[], excludeKeys: string[]): string[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).filter(
    (k) =>
      !excludeKeys.includes(k) &&
      rows.some((row) => typeof row[k] === "string" && !isNumericValue(row[k])),
  );
}

/**
 * Pivot long rows (`axis, group, value`) into wide rows keyed by the axis
 * value, one column per distinct group.
 */
export function pivotByGroup(
  rows: QueryResultRow[],
  axisKey: string,
  groupKey: string,
  valueKey: string,
): {
  pivoted: QueryResultRow[];
  seriesKeys: string[];
} {
  const byAxis = new Map<string | number | boolean | null, QueryResultRow>();
  const seriesSet = new Set<string>();

  for (const row of rows) {
    const axis = row[axisKey];
    // The raw group value is the series identifier — keep it intact (it's the
    // label, and uniqueness comes from the Set, not from mangling the name).
    const group = String(row[groupKey]);
    const value = toNumber(row[valueKey]);
    seriesSet.add(group);

    let entry = byAxis.get(axis);
    if (!entry) {
      entry = { [axisKey]: axis };
      byAxis.set(axis, entry);
    }
    entry[group] = value;
  }

  // First-seen order, not alphabetical: a stacked chart stacks its series in
  // this order, so the author's `ORDER BY` is the only way to say which band
  // sits at the bottom (a phase breakdown reads bottom-up in time order).
  // Every query that pivots already carries an ORDER BY, so this is as stable
  // across refreshes as sorting was.
  const seriesKeys = [...seriesSet];
  const pivoted = [...byAxis.values()];
  return { pivoted, seriesKeys };
}

/**
 * Normalize a numeric epoch to milliseconds. ClickHouse `toUnixTimestamp(...)`
 * returns SECONDS (and `toUnixTimestamp64Milli` returns ms); disambiguate by
 * magnitude — any realistic date is < 1e12 in seconds and >= 1e12 in ms. Without
 * this, a seconds value is read as ms and lands near 1970, then gets filtered
 * out of the selected range.
 */
function epochToMs(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  return n < 1e12 ? n * 1000 : n;
}

/**
 * Milliseconds since epoch, or null when the value isn't a timestamp. Callers
 * must drop null rows — a sentinel like 0 would be a valid instant (1970) that
 * sorts to the front and corrupts first/last calculations and sparklines.
 */
export function toTimestamp(value: unknown): number | null {
  if (typeof value === "number") return epochToMs(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    // A bare epoch returned as a (quoted) string, e.g. toUnixTimestamp64Milli
    // (Int64 → quoted) or toUnixTimestamp wrapped in toString.
    if (/^\d+$/.test(trimmed)) return epochToMs(Number(trimmed));
    // Anything else is a ClickHouse DateTime/Date string, assumed UTC.
    const parsed = parseTimestampAsUTC(trimmed);
    if (parsed) return parsed.getTime();
  }
  return null;
}

/** The index of the sample nearest `target` in ascending `samples`; null
 * only when there are none. */
export function nearestSampleIndex(samples: readonly number[], target: number): number | null {
  let nearest: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  samples.forEach((sample, index) => {
    if (Math.abs(sample - target) < distance) {
      distance = Math.abs(sample - target);
      nearest = index;
    }
  });
  return nearest;
}

/** The width of the buckets starting at ascending `starts`: the smallest gap
 * between them, as a query can skip empty ones. 0 for a lone bucket. */
export function bucketStep(starts: readonly number[]): number {
  let step = 0;
  starts.forEach((start, i) => {
    const gap = start - (starts[i - 1] ?? start);
    if (gap > 0 && (step === 0 || gap < step)) step = gap;
  });
  return step;
}

/**
 * The index of the bucket containing `target`, where `starts` are the
 * ascending start times of buckets `bucketStep` wide. Null outside them all,
 * including in a skipped one; a lone bucket has no width to measure and only
 * contains its own start.
 */
export function bucketIndexAt(starts: readonly number[], target: number): number | null {
  const step = bucketStep(starts);
  let index: number | null = null;
  starts.forEach((start, i) => {
    if (start <= target) index = i;
  });
  if (index === null) return null;
  const start = starts[index] ?? target;
  return target < start + step || target === start ? index : null;
}
