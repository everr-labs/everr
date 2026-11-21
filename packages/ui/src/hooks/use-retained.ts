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

/**
 * A dialog open while `target` is set. `shown` keeps the content through the
 * exit animation; `key` changes on each opening, so a form keyed by it starts
 * over instead of holding the last opening's text.
 */
export function useOverlayContent<T>(target: T | null) {
  const open = target !== null;
  const shown = useRetained(target);
  const [state, setState] = useState({ open, key: open ? 1 : 0 });
  if (open !== state.open) setState({ open, key: open ? state.key + 1 : state.key });
  return { open, shown, key: state.key };
}
