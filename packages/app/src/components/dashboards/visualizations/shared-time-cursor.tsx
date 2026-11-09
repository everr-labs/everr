import { cn } from "@everr/ui/lib/utils";
import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

interface TimeCursor {
  source: symbol;
  timestamp: number;
}

interface TimeCursorStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => TimeCursor | null;
  set: (source: symbol, timestamp: number) => void;
  clear: (source: symbol) => void;
}

function createTimeCursorStore(): TimeCursorStore {
  let cursor: TimeCursor | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => cursor,
    set(source, timestamp) {
      if (cursor?.source === source && cursor.timestamp === timestamp) return;
      cursor = { source, timestamp };
      notify();
    },
    clear(source) {
      if (cursor?.source !== source) return;
      cursor = null;
      notify();
    },
  };
}

const inactiveStore: TimeCursorStore = {
  subscribe: () => () => {},
  getSnapshot: () => null,
  set: () => {},
  clear: () => {},
};
const TimeCursorContext = createContext<TimeCursorStore>(inactiveStore);

export function SharedTimeCursorProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createTimeCursorStore);
  return <TimeCursorContext.Provider value={store}>{children}</TimeCursorContext.Provider>;
}

/**
 * The instant hovered in any panel of the dashboard, or null. Read it only
 * in the component that draws the cursor: every reader re-renders on each
 * pointer move.
 */
export function useTimeCursor(): number | null {
  const store = useContext(TimeCursorContext);
  const timestamp = useCallback(() => store.getSnapshot()?.timestamp ?? null, [store]);
  return useSyncExternalStore(store.subscribe, timestamp, () => null);
}

/**
 * Points the dashboard's time cursor from this panel, without re-rendering
 * the panel when the cursor moves. The panel's claim is released when it
 * unmounts.
 */
export function usePointTimeCursor() {
  const store = useContext(TimeCursorContext);
  const [source] = useState(() => Symbol("panel"));
  useEffect(() => () => store.clear(source), [store, source]);
  const set = useCallback((timestamp: number) => store.set(source, timestamp), [store, source]);
  const clear = useCallback(() => store.clear(source), [store, source]);
  return { set, clear };
}

/**
 * The dashed line that marks the shared cursor, spanning the box `style`
 * gives it. Every time-based panel draws its cursor with it.
 */
export function CursorLine({
  horizontal = false,
  style,
}: {
  horizontal?: boolean;
  style: CSSProperties;
}) {
  return (
    <div
      data-slot="time-cursor"
      className={cn(
        "pointer-events-none absolute border-dashed border-muted-foreground/70",
        horizontal ? "border-t" : "border-l",
      )}
      style={style}
    />
  );
}
