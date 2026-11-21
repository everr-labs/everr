import { hashKey, type QueryKey } from "@tanstack/react-query";

/** A key with every time range taken out: a `timeRange` field, or an object
 *  that is nothing but `from` and `to`. */
function withoutTimeRange(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutTimeRange);
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 2 && keys.includes("from") && keys.includes("to")) return "time-range";
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "timeRange")
        .map(([key, field]) => [key, withoutTimeRange(field)]),
    );
  }
  return value;
}

/** What a query key asks for, apart from the time range: equal identities
 *  differ at most in their range. */
function timeRangeFreeIdentity(queryKey: QueryKey): string {
  return hashKey([withoutTimeRange(queryKey)]);
}

/**
 * `placeholderData` that keeps the previous answer on screen while only the
 * time range moved, and drops it for anything else: another rule's numbers
 * under this one's name would be wrong, not stale.
 *
 * For `useQuery` only. `useQueries` builds a new observer whenever a key
 * changes, so its placeholder never sees the previous query.
 */
export function keepAcrossTimeRange(queryKey: QueryKey) {
  const identity = timeRangeFreeIdentity(queryKey);
  return <T>(previous: T | undefined, previousQuery?: { queryKey: QueryKey }) =>
    previousQuery && timeRangeFreeIdentity(previousQuery.queryKey) === identity
      ? previous
      : undefined;
}
