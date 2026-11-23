// The only module allowed to import TanStack's `queryOptions` and
// `infiniteQueryOptions` (lint enforces it), so every query declares whether
// it reads the data the page shows.
import {
  type DefaultError,
  type InfiniteData,
  infiniteQueryOptions,
  type Query,
  type QueryKey,
  queryOptions,
  type UnusedSkipTokenInfiniteOptions,
  type UnusedSkipTokenOptions,
  useIsFetching,
} from "@tanstack/react-query";

/** Whether `query` was built with {@link dataQueryOptions} or its infinite form. */
export const isDataQuery = (query: Query) => query.meta?.data === true;

/**
 * A query that reads what the page shows: the telemetry or CI data the time
 * range or a refresh changes. Refresh refetches only these, and the Refresh
 * button spins while one loads.
 */
export function dataQueryOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(options: UnusedSkipTokenOptions<TQueryFnData, TError, TData, TQueryKey>) {
  return queryOptions({ ...options, meta: { ...options.meta, data: true } });
}

/** The infinite form of {@link dataQueryOptions}. */
export function dataInfiniteQueryOptions<
  TQueryFnData,
  TError = DefaultError,
  TData = InfiniteData<TQueryFnData>,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
>(options: UnusedSkipTokenInfiniteOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>) {
  return infiniteQueryOptions({ ...options, meta: { ...options.meta, data: true } });
}

/**
 * A query for the app's own state rather than the data the page shows: the
 * session, settings, API keys, dashboard and runbook definitions, filter
 * value lists. Refresh leaves it alone.
 */
export const appQueryOptions = queryOptions;

/** The infinite form of {@link appQueryOptions}. */
export const appInfiniteQueryOptions = infiniteQueryOptions;

/** Whether any data query is loading, whatever started it. */
export function useIsFetchingData(): boolean {
  return useIsFetching({ predicate: isDataQuery }) > 0;
}
