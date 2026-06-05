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

export function getValueKeys(row: QueryResultRow, timeKey: string): string[] {
  return Object.keys(row).filter(
    (k) => k !== timeKey && typeof row[k] === "number",
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
