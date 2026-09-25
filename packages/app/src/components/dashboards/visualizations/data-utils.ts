import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import { isNumericValue, toNumber } from "@/lib/numeric";
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

/** Tick label formatter for a time axis: date for multi-day spans, time otherwise. */
export function createTimeTickFormatter(domain: [number, number]) {
  const span = domain[1] - domain[0];
  return (ms: number) => {
    const d = new Date(ms);
    if (span > 86_400_000) {
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    }
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  };
}

/** Clock-aligned tick positions across a time domain, at most maxTicks of them. */
export function generateTimeTicks(
  domain: [number, number],
  maxTicks: number,
): number[] {
  const span = domain[1] - domain[0];
  if (span <= 0) return [];

  const ideal = span / maxTicks;
  const interval =
    TICK_INTERVALS.find((i) => i >= ideal) ?? TICK_INTERVALS.at(-1) ?? 1_000;

  const first = Math.ceil(domain[0] / interval) * interval;
  const ticks: number[] = [];
  for (let t = first; t <= domain[1]; t += interval) {
    ticks.push(t);
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
 */
export function niceLinearDomain(
  min: number,
  max: number,
  tickCount = 5,
  bounds: { min?: number; max?: number } = {},
): { domain: [number, number]; ticks: number[] } {
  const dataMin = Number.isFinite(min) ? min : 0;
  const dataMax = Number.isFinite(max) ? max : 0;
  const span = Math.max(0, dataMax - dataMin);
  const flatZero = dataMin === 0 && dataMax === 0;
  const padding =
    span > 0 ? span * 0.1 : flatZero ? 1 : Math.abs(dataMin) * 0.1;
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
  const step = niceStep(Math.max(hi0 - lo0, Number.EPSILON) / (tickCount - 1));
  const lo = bounds.min ?? Math.floor(lo0 / step) * step;
  const hi = bounds.max ?? Math.ceil(hi0 / step) * step;
  const ticks: number[] = [];
  // Rounded per tick: repeated addition of a step like 0.2 accumulates binary
  // error into labels such as "0.6000000000000001".
  if (bounds.min !== undefined || bounds.max !== undefined) {
    ticks.push(lo);
    const first = Math.ceil(lo / step) * step;
    for (let tick = first; tick < hi; tick += step) {
      if (tick > lo) ticks.push(Number(tick.toPrecision(12)));
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
export function getValueKeys(
  rows: QueryResultRow[],
  timeKey: string,
): string[] {
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
export function getGroupKeys(
  rows: QueryResultRow[],
  excludeKeys: string[],
): string[] {
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
  const byAxis = new Map<string | number, QueryResultRow>();
  const seriesSet = new Set<string>();

  for (const row of rows) {
    const axis = row[axisKey];
    // The raw group value is the series identifier — keep it intact (it's the
    // label, and uniqueness comes from the Set, not from mangling the name).
    const group = String(row[groupKey]);
    const value = toNumber(row[valueKey]);
    seriesSet.add(group);

    let entry = byAxis.get(axis as string | number);
    if (!entry) {
      entry = { [axisKey]: axis };
      byAxis.set(axis as string | number, entry);
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
