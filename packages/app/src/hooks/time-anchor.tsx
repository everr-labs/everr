import { useTimeRange } from "@everr/telemetry-explorer/shell";
import { useRefreshInstant } from "@everr/ui/lib/refresh-epoch";
import { useMatches } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useMemo } from "react";

type TimeAnchor = { at: number; epoch: number };

const TimeAnchorContext = createContext<TimeAnchor | null>(null);

/**
 * Resolves the page's range at one instant for every panel under it, so they
 * all agree on `now`: the same until the page, its range or a refresh changes
 * it. A panel loaded later, or re-run by a variable, reads the same instant.
 * `epoch` counts refreshes, so a range that resolves the same, such as an
 * absolute one or Today, still refetches on refresh.
 */
export function TimeAnchorProvider({ children }: { children: ReactNode }) {
  const { timeRange } = useTimeRange();
  // The page on screen, not one still loading. A maximized panel is still its
  // dashboard's page, so maximizing and restoring keep the instant.
  const page = useMatches({
    select: (matches) =>
      matches
        .filter((match) => !match.routeId.endsWith("/panel/$panelKey"))
        .at(-1)
        ?.pathname.replace(/\/$/, ""),
  });
  const { at, epoch } = useRefreshInstant(`${page}\u0000${timeRange.from}\u0000${timeRange.to}`);
  const anchor = useMemo(() => ({ at, epoch }), [at, epoch]);
  return <TimeAnchorContext.Provider value={anchor}>{children}</TimeAnchorContext.Provider>;
}

/** The instant the page resolves its range at, and the refresh it was taken for. */
export function useTimeAnchor(): TimeAnchor {
  const anchor = useContext(TimeAnchorContext);
  if (anchor === null) throw new Error("useTimeAnchor needs a TimeAnchorProvider");
  return anchor;
}
