import type { FilterOptionsCache } from "../filters/data/filter-options-cache";

/** A cache in memory, with the entries a test starts from, keyed as a builder keys them. */
export function memoryFilterOptionsCache(
  seed: [readonly string[], unknown][] = [],
): FilterOptionsCache {
  const entries = new Map(seed.map(([key, data]) => [JSON.stringify(key), data]));
  return {
    read: <T>(key: readonly string[]) => entries.get(JSON.stringify(key)) as T | undefined,
    write: (key, data) => void entries.set(JSON.stringify(key), data),
  };
}
