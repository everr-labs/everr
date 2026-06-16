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
 * Whether a value is numeric. ClickHouse's JSONEachRow encodes 64-bit integers
 * (e.g. `count()`, `sum()`) as quoted strings to preserve precision, so a
 * numeric string counts as numeric here.
 */
export function isNumericValue(value: unknown): boolean {
  return toNumber(value) !== null;
}
