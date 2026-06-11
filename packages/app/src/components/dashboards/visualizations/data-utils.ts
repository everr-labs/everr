import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import type { QueryResultRow } from "./index";

/** Shared series palette. Index 0 doubles as the accent color for brush
 * selections and sparklines. */
export const SERIES_COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(142, 71%, 45%)",
  "hsl(0, 84%, 60%)",
  "hsl(280, 68%, 60%)",
  "hsl(35, 92%, 50%)",
  "hsl(190, 90%, 50%)",
];

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
 * Whether a value is numeric. ClickHouse's JSONEachRow encodes 64-bit integers
 * (e.g. `count()`, `sum()`) as quoted strings to preserve precision, so a
 * numeric string counts as numeric here — otherwise stat/time-series panels
 * would see no value columns and render empty.
 */
export function isNumericValue(value: unknown): boolean {
  return toNumber(value) !== null;
}

/** Coerce a numeric value (number or numeric string) to a number, else null. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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
