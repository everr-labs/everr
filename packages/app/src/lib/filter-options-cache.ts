import type { FilterOptionsCache } from "@everr/telemetry-explorer/filters";
import { useRouteContext } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { readLocalStorage, writeLocalStorage } from "#app/lib/local-storage.ts";

const STORAGE_PREFIX = "everr.filter-options.";
const MAX_ENTRIES = 100;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const entriesSchema = z.record(z.string(), z.object({ at: z.number(), data: z.any() }));
type Entries = z.infer<typeof entriesSchema>;

// Parsed once per identity, so a read while rendering never parses JSON.
const loaded = new Map<string, Entries>();

function entriesFor(storageKey: string): Entries {
  let entries = loaded.get(storageKey);
  if (!entries) {
    entries = readLocalStorage(storageKey, entriesSchema) ?? {};
    loaded.set(storageKey, entries);
  }
  return entries;
}

/**
 * The last list each Explore filter dropdown loaded, kept in this browser for
 * one user and organization, so a dropdown opens with a list after a reload,
 * in a new tab, or after a time range change.
 */
export function createFilterOptionsCache(
  userId: string,
  organizationId: string | null | undefined,
): FilterOptionsCache | undefined {
  if (!organizationId) return undefined;
  const storageKey = `${STORAGE_PREFIX}v1:${userId}:${organizationId}`;
  return {
    read(key) {
      if (typeof window === "undefined") return undefined;
      const entry = entriesFor(storageKey)[JSON.stringify(key)];
      return entry && Date.now() - entry.at <= MAX_AGE_MS ? entry.data : undefined;
    },
    write(key, data) {
      if (typeof window === "undefined") return;
      // Re-read the stored map first: another tab may have added entries since this one loaded it.
      loaded.delete(storageKey);
      const now = Date.now();
      const entries = { ...entriesFor(storageKey), [JSON.stringify(key)]: { at: now, data } };
      const newest = Object.entries(entries)
        .filter(([, entry]) => now - entry.at <= MAX_AGE_MS)
        .sort(([, a], [, b]) => b.at - a.at)
        .slice(0, MAX_ENTRIES);
      const kept = Object.fromEntries(newest);
      loaded.set(storageKey, kept);
      writeLocalStorage(storageKey, kept);
    },
  };
}

/** The cache for the signed-in user and active organization of the current page. */
export function useFilterOptionsCache(): FilterOptionsCache | undefined {
  const userId = useRouteContext({
    from: "/_authenticated",
    select: (context) => context.session.user.id,
  });
  const organizationId = useRouteContext({
    from: "/_authenticated",
    select: (context) => context.session.session.activeOrganizationId,
  });
  return useMemo(() => createFilterOptionsCache(userId, organizationId), [userId, organizationId]);
}

/** Removes every stored list, for sign-out: a shared device must not keep tenant data. */
export function clearFilterOptionsCache() {
  loaded.clear();
  if (typeof window === "undefined") return;
  try {
    const { localStorage } = window;
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    for (const key of keys) {
      if (key?.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Blocked storage has nothing of ours to clear.
  }
}
