import { useSyncExternalStore } from "react";

// Per-preview bar dismissal in a module-level store (shared and reactive, no
// server). Keyed by preview name so dismissing one preview's banner doesn't
// hide it for the others; module scope survives navigation within a preview.
// Deliberately NOT the query cache: a queryFn-less query gets "refetched" by
// broad invalidations and logs a missing-queryFn error.
const dismissed = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePreviewDismissed(
  preview: string,
): readonly [boolean, () => void] {
  const isDismissed = useSyncExternalStore(
    subscribe,
    () => dismissed.has(preview),
    () => false,
  );
  const dismiss = () => {
    dismissed.add(preview);
    for (const listener of listeners) {
      listener();
    }
  };
  return [isDismissed, dismiss];
}
