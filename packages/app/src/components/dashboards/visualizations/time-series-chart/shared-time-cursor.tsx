import {
  createContext,
  type ReactNode,
  useContext,
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

export function SharedTimeCursorProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [store] = useState(createTimeCursorStore);
  return (
    <TimeCursorContext.Provider value={store}>
      {children}
    </TimeCursorContext.Provider>
  );
}

export function useSharedTimeCursor() {
  const store = useContext(TimeCursorContext);
  const cursor = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    inactiveStore.getSnapshot,
  );
  return { cursor, store };
}
