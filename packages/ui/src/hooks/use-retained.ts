import { useState } from "react";

/**
 * The last non-null `value`, held after `value` goes back to null.
 *
 * An overlay opened on a value (`open={target !== null}`) is still on screen
 * for its exit animation after the target is cleared. Rendering its content
 * from the target itself empties it, or unmounts it, on the frame the close
 * starts, so it vanishes instead of animating out. Rendering from this keeps
 * the content as it was until the overlay is gone.
 */
export function useRetained<T>(value: T | null): T | null {
  const [retained, setRetained] = useState(value);
  // Adjusted during render, not in an effect: an effect would paint one
  // frame with the stale value before correcting it.
  if (value !== null && value !== retained) setRetained(value);
  return value ?? retained;
}

/**
 * How many times `open` has turned true. Keyed on it, an overlay's form
 * starts fresh on each opening while staying mounted through the exit
 * animation that unmounting it on close would cut short.
 */
export function useOpenCount(open: boolean): number {
  const [state, setState] = useState({ open, count: open ? 1 : 0 });
  if (open !== state.open) setState({ open, count: open ? state.count + 1 : state.count });
  return state.count;
}
