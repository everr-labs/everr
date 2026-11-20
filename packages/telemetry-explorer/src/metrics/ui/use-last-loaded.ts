import { useState } from "react";

/**
 * Each value, or while it loads again, the last one loaded under the same
 * key. `useQueries` starts a new observer when a query's key changes, so its
 * `placeholderData` never sees the previous result; this keeps a chart on
 * screen while the same query refetches with another range or filter. A
 * value of `null` is loaded, not missing. The returned array keeps its
 * identity until a value or key changes.
 */
export function useLastLoaded<T>(
  values: readonly (T | undefined)[],
  keys: readonly string[],
): readonly (T | undefined)[] {
  const [last, setLast] = useState<{
    keys: readonly string[];
    values: readonly (T | undefined)[];
  }>({ keys, values });
  const next = values.map((value, i) =>
    value !== undefined ? value : last.keys[i] === keys[i] ? last.values[i] : undefined,
  );
  const changed =
    keys.length !== last.keys.length ||
    keys.some((key, i) => key !== last.keys[i]) ||
    next.some((value, i) => value !== last.values[i]);
  // Storing what the previous render showed, as React recommends over an effect.
  if (changed) setLast({ keys, values: next });
  return changed ? next : last.values;
}
