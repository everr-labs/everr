import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import { isNumericValue, toNumber } from "@/lib/numeric";
import type { QueryResultRow } from "./index";

export { toNumber };

/**
 * Shared series palette. Index 0 doubles as the accent color for brush
 * selections and sparklines.
 *
 * ORDER IS LOAD-BEARING and entries are append-only: charts assign colors by
 * series index, so inserting or reordering re-colors every saved dashboard.
 *
 * The first six are the widely-spaced hues. Six hues is about what hue alone
 * can keep apart, so the rest separate on LIGHTNESS as well — each sits in a
 * hue gap and is visibly darker or lighter than its nearest neighbour. That
 * ordering also means the most distinguishable colors are used first, and a
 * value difference (unlike a hue difference) survives every form of color
 * blindness.
 */
export const SERIES_COLORS = [
  "hsl(217, 91%, 60%)", // blue
  "hsl(142, 71%, 45%)", // green
  "hsl(0, 84%, 60%)", // red
  "hsl(280, 68%, 60%)", // purple
  "hsl(35, 92%, 50%)", // orange
  "hsl(190, 90%, 50%)", // cyan
  "hsl(330, 80%, 62%)", // rose — the widest remaining hue gap
  "hsl(85, 62%, 42%)", // olive — darker, so it holds against green
  "hsl(250, 78%, 70%)", // indigo — lighter, so it holds against blue/purple
  "hsl(168, 72%, 34%)", // deep teal — darker than both green and cyan
  "hsl(20, 68%, 44%)", // rust — darker orange
  "hsl(300, 44%, 48%)", // plum — darker, desaturated purple
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
    TICK_INTERVALS.find((i) => i >= ideal) ?? TICK_INTERVALS.at(-1)!;

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
 * recharts will size a value axis on its own, but it keeps the result to
 * itself, so anything that has to turn a cursor height back into a value (the
 * hover highlight) has nowhere to read it from. Declaring the axis fixes that
 * and picks rounder steps besides: recharts' own algorithm is happy to land on
 * 35, 65 or 1500, where this one holds to 1, 2, 2.5 and 5.
 *
 * The floor is pinned at zero unless the data goes below it, so a series'
 * height on the plot stays proportional to its value.
 */
export function niceLinearDomain(
  min: number,
  max: number,
  tickCount = 5,
): { domain: [number, number]; ticks: number[] } {
  const lo0 = Math.min(0, Number.isFinite(min) ? min : 0);
  const hi0 = Math.max(lo0, Number.isFinite(max) ? max : 0);
  // A flat series still needs an axis with height, or it plots on the edge.
  const step = niceStep(Math.max(hi0 - lo0, Number.EPSILON) / (tickCount - 1));
  const lo = Math.floor(lo0 / step) * step;
  const hi = Math.ceil(hi0 / step) * step;
  const ticks: number[] = [];
  // Rounded per tick: repeated addition of a step like 0.2 accumulates binary
  // error into labels such as "0.6000000000000001".
  for (let i = 0; lo + i * step <= hi + step / 2; i++) {
    ticks.push(Number((lo + i * step).toPrecision(12)));
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

  const seriesKeys = [...seriesSet].sort();
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
