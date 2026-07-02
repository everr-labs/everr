import { useSyncExternalStore } from "react";

// In-memory dismissal store for the preview pill. A user can dismiss the pill to
// get it out of the way without leaving preview mode (the header
// PreviewIndicator still signals they're in a preview). Dismissal is
// deliberately NOT persisted: this module-level state resets on a full page
// reload — the pill reappears — but survives client-side navigation because the
// module stays live across route changes.
//
// The dismissal is keyed by preview NAME, so switching to a different preview
// shows the pill again (its name isn't in the set) while returning to a
// previously dismissed one keeps it hidden. Consumed via `useSyncExternalStore`
// so React re-renders on dismissal without any useEffect prop-syncing: the
// component derives visibility from this store plus the URL, and dismissal is a
// plain event-driven write.

// Replaced (never mutated in place) on each write so `useSyncExternalStore`'s
// Object.is snapshot check sees a new reference and re-renders. Empty on the
// server and on every fresh load.
let dismissed = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): ReadonlySet<string> {
  return dismissed;
}

/** Hide the pill for this preview name until the next full page reload. */
export function dismissPreview(name: string): void {
  if (dismissed.has(name)) return;
  const next = new Set(dismissed);
  next.add(name);
  dismissed = next;
  for (const listener of listeners) listener();
}

/** True when the pill for `name` has been dismissed this session. */
export function useIsPreviewDismissed(name: string | undefined): boolean {
  const set = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return name ? set.has(name) : false;
}

/** Test-only: clears dismissals so cases don't leak module state into each other. */
export function __resetPreviewDismissals(): void {
  if (dismissed.size === 0) return;
  dismissed = new Set<string>();
  for (const listener of listeners) listener();
}
