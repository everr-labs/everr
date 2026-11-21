import { useState } from "react";

/**
 * The last non-null `value`. An overlay opened on `target !== null` is still
 * animating out after the target clears; rendering from this keeps its content
 * instead of emptying it on the first frame of the close.
 */
export function useRetained<T>(value: T | null): T | null {
  const [retained, setRetained] = useState(value);
  // During render, not in an effect, which would paint one stale frame.
  if (value !== null && value !== retained) setRetained(value);
  return value ?? retained;
}

/** How many times `open` has turned true. As a key, it resets a form on each
 *  opening while it stays mounted through the exit animation. */
export function useOpenCount(open: boolean): number {
  const [state, setState] = useState({ open, count: open ? 1 : 0 });
  if (open !== state.open) setState({ open, count: open ? state.count + 1 : state.count });
  return state.count;
}
