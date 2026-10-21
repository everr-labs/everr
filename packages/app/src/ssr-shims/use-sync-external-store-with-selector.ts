import { useDebugValue, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: undefined | null | (() => Snapshot),
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
  const instRef = useRef<{ hasValue: boolean; value: Selection | null } | null>(null);
  if (instRef.current === null) {
    instRef.current = { hasValue: false, value: null };
  }
  const inst = instRef.current;

  const [getSelection, getServerSelection] = useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot: Snapshot;
    let memoizedSelection: Selection;

    const memoizedSelector = (nextSnapshot: Snapshot) => {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        const nextSelection = selector(nextSnapshot);
        if (isEqual !== undefined && inst.hasValue) {
          // oxlint-disable-next-line typescript/consistent-type-assertions -- faithful port of React's useSyncExternalStoreWithSelector shim: inst.value holds a Selection once inst.hasValue is true, but the null-initialized generic slot can't express that.
          const currentSelection = inst.value as Selection;
          if (isEqual(currentSelection, nextSelection)) {
            memoizedSelection = currentSelection;
            return currentSelection;
          }
        }
        memoizedSelection = nextSelection;
        return nextSelection;
      }

      if (Object.is(memoizedSnapshot, nextSnapshot)) {
        return memoizedSelection;
      }

      const nextSelection = selector(nextSnapshot);
      if (isEqual?.(memoizedSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;
        return memoizedSelection;
      }

      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    };

    const getSnap = () => memoizedSelector(getSnapshot());
    const getServerSnap =
      getServerSnapshot === undefined || getServerSnapshot === null
        ? undefined
        : () => memoizedSelector(getServerSnapshot());

    return [getSnap, getServerSnap];
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- faithful port of React's useSyncExternalStore shim; deps match upstream
  }, [getSnapshot, getServerSnapshot, selector, isEqual]);

  const value = useSyncExternalStore(subscribe, getSelection, getServerSelection);

  useEffect(() => {
    inst.hasValue = true;
    inst.value = value;
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- faithful port of React's useSyncExternalStore shim; deps match upstream
  }, [value]);

  useDebugValue(value);
  return value;
}
