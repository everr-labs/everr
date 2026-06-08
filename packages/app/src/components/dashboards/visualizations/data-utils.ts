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

/**
 * Whether a value is numeric. ClickHouse's JSONEachRow encodes 64-bit integers
 * (e.g. `count()`, `sum()`) as quoted strings to preserve precision, so a
 * numeric string counts as numeric here — otherwise stat/time-series panels
 * would see no value columns and render empty.
 */
export function isNumericValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed !== "" && Number.isFinite(Number(trimmed));
  }
  return false;
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

export function getValueKeys(row: QueryResultRow, timeKey: string): string[] {
  return Object.keys(row).filter(
    (k) => k !== timeKey && isNumericValue(row[k]),
  );
}

export function toTimestamp(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const ms = new Date(`${value.replace(" ", "T")}Z`).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}
