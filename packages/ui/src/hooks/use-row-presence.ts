import { type AnimationEvent, useState } from "react";

type RowPhase = "idle" | "enter" | "exit";
interface RowEntry<T> {
  key: string;
  row: T;
  phase: RowPhase;
}

/**
 * The rows to render: the current data, plus rows that just left and are
 * still animating out, kept at the position they left from.
 */
function reconcileRows<T>(
  data: T[],
  previous: RowEntry<T>[],
  rowKey: (row: T, index: number) => string,
): RowEntry<T>[] {
  const before = new Map(previous.map((entry) => [entry.key, entry]));
  const next: RowEntry<T>[] = data.map((row, index) => {
    const key = rowKey(row, index);
    const old = before.get(key);
    const phase: RowPhase = old && old.phase !== "exit" ? old.phase : "enter";
    return { key, row, phase };
  });
  const present = new Set(next.map((entry) => entry.key));
  previous.forEach((entry, index) => {
    if (!present.has(entry.key)) {
      next.splice(Math.min(index, next.length), 0, { ...entry, phase: "exit" });
    }
  });
  return next;
}

function idleRows<T>(data: T[], rowKey: (row: T, index: number) => string): RowEntry<T>[] {
  return data.map((row, index) => ({ key: rowKey(row, index), row, phase: "idle" }));
}

/**
 * Rows for a list whose items animate in and out. Rows added after the first
 * render are marked "enter"; rows that left stay, marked "exit", until the
 * `row-exit` animation on their cells ends. Derived during render, not in an effect.
 * Disabled, every row is "idle" and leaves at once.
 */
export function useRowPresence<T>(
  data: T[],
  rowKey: (row: T, index: number) => string,
  enabled = true,
) {
  const [seenData, setSeenData] = useState(data);
  const [entries, setEntries] = useState(() => idleRows(data, rowKey));
  // Track the data while disabled too, so turning animations back on doesn't
  // replay rows that changed in the meantime.
  if (data !== seenData) {
    setSeenData(data);
    setEntries(enabled ? reconcileRows(data, entries, rowKey) : idleRows(data, rowKey));
  }
  const rows = enabled ? entries : idleRows(data, rowKey);

  // `row-exit` runs on the row's cells and bubbles here, as do the cells'
  // other animations; only `row-exit` removes the row.
  const onExitEnd = (key: string) => (event: AnimationEvent) => {
    if (event.animationName !== "row-exit") return;
    setEntries((current) => current.filter((e) => !(e.key === key && e.phase === "exit")));
  };

  return { rows, onExitEnd };
}
