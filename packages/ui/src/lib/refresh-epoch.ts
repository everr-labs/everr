import {
  type Query,
  type QueryClient,
  type QueryFilters,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getRefreshIntervalMs } from "../components/refresh-picker";

let epoch = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useRefreshEpoch(): number {
  return useSyncExternalStore(
    subscribe,
    () => epoch,
    () => 0,
  );
}

/**
 * The time a page reads its relative range at, taken when `key` changes or
 * the page refreshes, never on a render alone, so charts move on when the
 * viewer changes them or refreshes, not because they drew again. `epoch`
 * counts the refreshes.
 */
export function useRefreshInstant(key: string): { at: number; epoch: number } {
  const current = useRefreshEpoch();
  const full = `${key}\u0000${current}`;
  const [instant, setInstant] = useState(() => ({ key: full, at: Date.now() }));
  if (instant.key === full) return { at: instant.at, epoch: current };
  // Storing what changed since the previous render, as React recommends over an effect.
  const next = { key: full, at: Date.now() };
  setInstant(next);
  return { at: next.at, epoch: current };
}

const isRefreshKeyed = (query: Query) => query.meta?.refreshKeyed === true;

/**
 * Options for a query whose key holds a range read at a refresh instant. A
 * refresh gives it a new key, so it is never refetched under the old one, and
 * the old entry is only kept briefly as nothing can read it again.
 */
export const REFRESH_KEYED = {
  meta: { refreshKeyed: true },
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: 60_000,
} as const;

/**
 * Refreshes the page: moves its charts to a new instant, then refetches every
 * other query matching `filters`. Charts refetch through their new key, so
 * invalidating them too would fetch them twice.
 */
export function refreshPage(queryClient: QueryClient, filters: QueryFilters = {}): void {
  epoch += 1;
  for (const listener of listeners) listener();
  void queryClient.invalidateQueries({
    ...filters,
    predicate: (query) => !isRefreshKeyed(query) && (filters.predicate?.(query) ?? true),
  });
}

/**
 * Refreshes the page's queries matching `filters` every `refresh` interval
 * while one is picked. Returns what the Refresh button does, the same refresh
 * once.
 */
export function usePageRefresh(refresh: string, filters?: QueryFilters): () => void {
  const queryClient = useQueryClient();
  const ms = getRefreshIntervalMs(refresh);
  useEffect(() => {
    if (!ms) return;
    const timer = setInterval(() => refreshPage(queryClient, filters), ms);
    return () => clearInterval(timer);
  }, [ms, queryClient, filters]);
  return () => refreshPage(queryClient, filters);
}
