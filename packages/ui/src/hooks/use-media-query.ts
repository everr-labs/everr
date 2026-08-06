import { useCallback, useSyncExternalStore } from "react";

/**
 * Reads a CSS media query and follows its changes.
 *
 * This hook uses useSyncExternalStore, and not useState with useEffect. The
 * browser MediaQueryList is an external store. The first render on the client
 * therefore reads the true value. With useEffect the first render gives `false`
 * and a second render corrects it, and the user sees the layout change.
 *
 * The snapshot on the server is `false`, so the server markup and the hydration
 * agree. A caller that selects a layout from this value must therefore use
 * `false` for the layout that is also correct without JavaScript.
 */
// One MediaQueryList for each query, shared by every caller. React reads
// getSnapshot more than one time for each render. Each call to matchMedia()
// reads the query and makes a new list, and the browser evaluates that list at
// every style recalculation until it removes the list. Without this cache a
// resize makes more renders, more renders make more lists, and each list adds
// work to each recalculation.
const mediaQueryLists = new Map<string, MediaQueryList>();

function mediaQueryList(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  const cached = mediaQueryLists.get(query);
  if (cached) return cached;
  const mql = window.matchMedia(query);
  mediaQueryLists.set(query, mql);
  return mql;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = mediaQueryList(query);
      if (!mql) return () => {};
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => mediaQueryList(query)?.matches ?? false,
    [query],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
