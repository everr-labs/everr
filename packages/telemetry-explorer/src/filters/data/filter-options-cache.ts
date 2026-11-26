import type { Query, QueryKey } from "@tanstack/react-query";
import { createContext, useContext } from "react";

/**
 * Where an app keeps the last list each filter dropdown loaded, so a dropdown
 * can open with a list before its request returns. Keys carry no time range:
 * the last known list is the best guess for any range.
 */
export interface FilterOptionsCache {
  read<T>(key: readonly string[]): T | undefined;
  write<T>(key: readonly string[], data: T): void;
}

const FilterOptionsCacheContext = createContext<FilterOptionsCache | undefined>(undefined);

export const FilterOptionsCacheProvider = FilterOptionsCacheContext.Provider;

export function useFilterOptionsCache(): FilterOptionsCache | undefined {
  return useContext(FilterOptionsCacheContext);
}

type KeepPrevious<TData> = (
  previous: TData | undefined,
  previousQuery: Query<TData, Error, TData, QueryKey> | undefined,
) => TData | undefined;

/**
 * The one place that decides how a list option builder uses the cache. A
 * fetched, non-empty list is stored under `key`; an empty one never replaces a
 * useful list. Until a query has data of its own, the stored list stands in for
 * it. A `placeholderData` already on the options wins, so a builder can keep
 * the previous results of the same list first. Without a cache the options
 * come back unchanged.
 */
export function withLastKnown<TData extends unknown[], O extends object>(
  options: O & { queryFn: () => Promise<TData>; placeholderData?: KeepPrevious<TData> },
  cache: FilterOptionsCache | undefined,
  key: readonly string[],
): O & { queryFn: () => Promise<TData>; placeholderData?: KeepPrevious<TData> } {
  if (!cache) return options;
  return {
    ...options,
    queryFn: async () => {
      const data = await options.queryFn();
      if (data.length > 0) cache.write(key, data);
      return data;
    },
    placeholderData: (previous, previousQuery) =>
      options.placeholderData?.(previous, previousQuery) ?? cache.read<TData>(key),
  };
}
