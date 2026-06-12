/**
 * Whether a value is numeric. ClickHouse's JSONEachRow encodes 64-bit integers
 * (e.g. `count()`, `sum()`) as quoted strings to preserve precision, so a
 * numeric string counts as numeric here.
 */
export function isNumericValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed !== "" && Number.isFinite(Number(trimmed));
  }
  return false;
}
