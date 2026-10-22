import { useEffect, useState } from "react";

export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!active) {
      // oxlint-disable-next-line react/set-state-in-effect -- Preserve the existing delayed-flag reset timing; moving this reset into render changes observable loading behavior.
      setDelayed(false);
      return;
    }
    const id = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(id);
  }, [active, delayMs]);
  return delayed;
}
