import { useEffect, useState } from "react";

export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [state, setState] = useState({ active, ready: false });
  if (state.active !== active) setState({ active, ready: false });
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setState({ active, ready: true }), delayMs);
    return () => clearTimeout(id);
  }, [active, delayMs]);
  return state.active === active && state.ready;
}
