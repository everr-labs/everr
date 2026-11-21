import { useRefreshInstant } from "@everr/ui/lib/refresh-epoch";
import { createContext, type ReactNode, useContext } from "react";
import { useTimeRange } from "./use-time-range";

const TimeAnchorContext = createContext<number | null>(null);

/**
 * Resolves the page's range at one instant for every panel under it, so they
 * all agree on `now`: the same until the range changes or the page refreshes.
 * A panel loaded later, or re-run by a variable, reads the same instant.
 */
export function TimeAnchorProvider({ children }: { children: ReactNode }) {
  const { timeRange } = useTimeRange();
  const { at } = useRefreshInstant(`${timeRange.from}\u0000${timeRange.to}`);
  return <TimeAnchorContext.Provider value={at}>{children}</TimeAnchorContext.Provider>;
}

/** The instant the page resolves its range at. */
export function useTimeAnchor(): number {
  const at = useContext(TimeAnchorContext);
  if (at === null) throw new Error("useTimeAnchor needs a TimeAnchorProvider");
  return at;
}
