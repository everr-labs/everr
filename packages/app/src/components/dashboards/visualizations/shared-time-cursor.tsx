import {
  createContext,
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

export interface TimeCursorStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => TimeCursor | null;
  set: (source: symbol, timestamp: number) => void;
  clear: (source: symbol) => void;
}

export function createTimeCursorStore(): TimeCursorStore {
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
 * A panel's hold on its dashboard's shared time cursor: the instant every
 * time-based panel marks, and setters that point it from this panel. The
 * panel's claim is released when it unmounts.
 */
export function useSharedTimeCursor() {
  const store = useContext(TimeCursorContext);
  const cursor = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    inactiveStore.getSnapshot,
  );
  const [source] = useState(() => Symbol("panel"));
  useEffect(() => () => store.clear(source), [store, source]);
  const set = useCallback((timestamp: number) => store.set(source, timestamp), [store, source]);
  const clear = useCallback(() => store.clear(source), [store, source]);
  return { timestamp: cursor?.timestamp ?? null, set, clear };
}

/**
 * The shared cursor as a dashed line across a track that spans `domain`, for
 * panels laid out in percentages of the time range.
 */
export function TimeCursorLine({
  timestamp,
  domain,
}: {
  timestamp: number | null;
  domain: [number, number];
}) {
  const [from, to] = domain;
  if (timestamp === null || to <= from || timestamp < from || timestamp > to) return null;
  return (
    <div
      data-slot="time-cursor"
      className="absolute inset-y-0 border-l border-dashed border-muted-foreground/70"
      style={{ left: `${((timestamp - from) / (to - from)) * 100}%` }}
    />
  );
}
