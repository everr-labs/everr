import { useSyncExternalStore } from "react";

type Clock = { get: () => number; subscribe: (listener: () => void) => () => void };

const clocks = new Map<number, Clock>();

function clockFor(intervalMs: number): Clock {
  const existing = clocks.get(intervalMs);
  if (existing) return existing;
  const listeners = new Set<() => void>();
  let now = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const clock: Clock = {
    get: () => {
      // Nothing ticks it while unwatched, so a reading older than a tick is
      // taken again. It stays one value across a render's repeated reads.
      if (listeners.size === 0 && Date.now() - now >= intervalMs) now = Date.now();
      return now;
    },
    subscribe: (listener) => {
      if (listeners.size === 0)
        timer = setInterval(() => {
          now = Date.now();
          for (const notify of listeners) notify();
        }, intervalMs);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) clearInterval(timer);
      };
    },
  };
  clocks.set(intervalMs, clock);
  return clock;
}

/**
 * The current time in milliseconds, moving on every `intervalMs`. Components
 * read the clock through this instead of `Date.now()` in render, which shows a
 * time that only moves when something else renders them (and the React
 * Compiler may keep from the first render). Every reader of one interval
 * shares a timer and agrees on the time.
 */
export function useNow(intervalMs = 60_000): number {
  const clock = clockFor(intervalMs);
  return useSyncExternalStore(clock.subscribe, clock.get, clock.get);
}
