import {
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult,
  useQueries,
} from "@tanstack/react-query";

/**
 * One result per option, with options that share a query key observed once:
 * a chart's queries often read the same metric, and `useQueries` warns about
 * duplicate keys. A key some option enables is fetched for all of them.
 */
export function useDistinctQueries<TData, TKey extends QueryKey>(
  queries: UseQueryOptions<TData, Error, TData, TKey>[],
): UseQueryResult<TData>[] {
  const keys = queries.map((query) => JSON.stringify(query.queryKey));
  const byKey = new Map<string, UseQueryOptions<TData, Error, TData, TKey>>();
  queries.forEach((query, i) => {
    const key = keys[i] ?? "";
    const kept = byKey.get(key);
    if (!kept || (kept.enabled === false && query.enabled !== false)) byKey.set(key, query);
  });
  const results = useQueries({ queries: [...byKey.values()] });
  const resultOf = new Map([...byKey.keys()].map((key, i) => [key, results[i]]));
  return keys.flatMap((key) => resultOf.get(key) ?? []);
}
