import { isNumericValue } from "@/lib/numeric";
import type { QueryResultRow } from "./index";

export function detectTimeKey(rows: QueryResultRow[]): string | undefined {
  const first = rows[0];
  if (!first) return undefined;

  const timePatterns =
    /^(time|timestamp|date|datetime|created_at|ts|period|bucket|interval)/i;
  for (const key of Object.keys(first)) {
    if (timePatterns.test(key)) return key;
  }
  return undefined;
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
function epochToMs(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 1e12 ? n * 1000 : n;
}

export function toTimestamp(value: unknown): number {
  if (typeof value === "number") return epochToMs(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    // A bare epoch returned as a (quoted) string, e.g. toUnixTimestamp64Milli
    // (Int64 → quoted) or toUnixTimestamp wrapped in toString.
    if (/^\d+$/.test(trimmed)) return epochToMs(Number(trimmed));
    // ClickHouse DateTime comes as `YYYY-MM-DD HH:MM:SS` (space-separated, UTC,
    // no timezone): normalize the separator and assume UTC. But don't append a
    // second `Z` when the value already carries a timezone (`...Z` or `±HH:MM`)
    // — that produced `...ZZ`, failed to parse, fell back to 0, and the row was
    // then filtered out of the time range.
    const isoish = trimmed.replace(" ", "T");
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(isoish);
    const hasTime = isoish.includes("T");
    const normalized = hasTime && !hasTimezone ? `${isoish}Z` : isoish;
    const ms = new Date(normalized).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}
