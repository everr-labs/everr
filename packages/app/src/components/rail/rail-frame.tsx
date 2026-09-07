import { ScrollArea } from "@everr/ui/components/scroll-area";
import { cn } from "@everr/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";
import * as z from "zod";

/**
 * The route options a rail frame needs, spread into the layout route that
 * renders one. `full` hides the rail and gives the whole width to what is
 * open; it lives in the URL so a full-screen view is linkable and survives a
 * reload (a deep link from an alert can land directly on it). `fullBleed`
 * tells the `_previewable` layout that this route owns its own scroll.
 *
 * The matching `retainSearchParams(["full"])` middleware stays spelled out in
 * each route. The frame flag is session state, not page state, so it has to
 * survive navigation the way `_dashboard` carries the preview and the time
 * range; the router types that middleware against the route's whole search
 * shape, which is not something this schema can stand in for.
 */
export const railFrameRouteOptions = {
  staticData: { fullBleed: true },
  validateSearch: z.object({
    full: z.boolean().optional().catch(undefined),
  }),
};

/**
 * The master-detail frame the Dashboards and Runbooks surfaces share, shaped
 * like the Explore rails (Logs, Errors, Traces): a 260px tinted, bordered rail
 * as the first grid column, and what is open as a pane that scrolls itself, so
 * the page never scrolls.
 *
 * `children` is what goes in that pane, because that is the half the two
 * surfaces genuinely differ on.
 */
export function RailFrame({
  label,
  full,
  rail,
  paneClassName,
  paneProps,
  children,
}: {
  /** Names the rail for assistive technology, e.g. "Dashboards". */
  label: string;
  full: boolean;
  rail: ReactNode;
  /** Extra layout for the scrolling pane, e.g. its padding or a container name. */
  paneClassName?: string;
  /** Attributes for the pane itself, e.g. the router's scroll-to-top marker. */
  paneProps?: ComponentProps<typeof ScrollArea>["viewportProps"];
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] [--rail:260px] md:grid-rows-[minmax(0,1fr)] md:transition-[grid-template-columns] md:duration-200 md:ease-sidebar motion-reduce:md:transition-none",
        full
          ? "md:grid-cols-[0px_minmax(0,1fr)]"
          : "md:grid-cols-[var(--rail)_minmax(0,1fr)]",
      )}
    >
      {/*
        `overflow-hidden` plus the fixed-width inner column keep the rail's
        content from reflowing while the track animates to zero; the rows
        inside keep their own scroll.
      */}
      <aside
        inert={full}
        aria-label={label}
        className={cn(
          "min-h-0 min-w-0 overflow-hidden border-b bg-muted/15 md:border-r md:border-b-0",
          // Stacked on narrow viewports the rail stays expanded: it is
          // navigation, not filters, so hiding it behind a button would bury
          // the only way to switch. Just under half the viewport leaves what
          // is open the larger share; the rows scroll.
          "max-md:max-h-[45dvh]",
          full && "max-md:hidden md:border-r-0",
        )}
      >
        <div className="flex h-full min-h-0 flex-col p-3 md:w-[var(--rail)]">
          {rail}
        </div>
      </aside>
      <ScrollArea
        render={<main />}
        className="min-h-0 min-w-0"
        viewportClassName={cn("overscroll-y-contain", paneClassName)}
        viewportProps={paneProps}
      >
        {children}
      </ScrollArea>
    </div>
  );
}
