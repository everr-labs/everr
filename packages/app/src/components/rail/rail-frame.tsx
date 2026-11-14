import { ScrollArea } from "@everr/ui/components/scroll-area";
import { Sheet, SheetContent, SheetTitle } from "@everr/ui/components/sheet";
import { useIsMobile } from "@everr/ui/hooks/use-mobile";
import { cn } from "@everr/ui/lib/utils";
import { useLocation } from "@tanstack/react-router";
import { type ComponentProps, createContext, type ReactNode, useContext, useState } from "react";
import * as z from "zod";

/**
 * How the frame's rail shows below `md`. With `collapsedOnNarrow`, what is open
 * gets the whole phone screen and the rail opens over it as a sheet
 * (`openSheet`) until the next navigation.
 */
interface RailFrameState {
  collapsedOnNarrow: boolean;
  openSheet: () => void;
}

const RailFrameContext = createContext<RailFrameState | null>(null);

export function useRailFrame() {
  return useContext(RailFrameContext);
}

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
  collapsedOnNarrow = false,
  children,
}: {
  /** Names the rail for assistive technology, e.g. "Dashboards". */
  label: string;
  full: boolean;
  /**
   * Below `md`, drop the rail from the layout and open it as a sheet when the pane's `FrameToggle` asks for it; the next navigation
   * (picking a row) closes it. Only where the pane carries a `FrameToggle`,
   * or the rail can't come back. Without it the rail stacks above the pane.
   */
  collapsedOnNarrow?: boolean;
  rail: ReactNode;
  /** Extra layout for the scrolling pane, e.g. its padding or a container name. */
  paneClassName?: string;
  /** Attributes for the pane itself, e.g. the router's scroll-to-top marker. */
  paneProps?: ComponentProps<typeof ScrollArea>["viewportProps"];
  children: ReactNode;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  // Keyed by the path it was opened on, so any navigation closes it again
  // without an effect resetting the state.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const narrowOpen = openOn === pathname;
  // Only decides whether the sheet may show: the layout itself hides the
  // rail with CSS, so the server markup is already right on a phone.
  const isMobile = useIsMobile();
  const narrowHidden = collapsedOnNarrow || full;
  return (
    <RailFrameContext.Provider value={{ collapsedOnNarrow, openSheet: () => setOpenOn(pathname) }}>
      <div
        className={cn(
          "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] [--rail:260px] md:grid-rows-[minmax(0,1fr)] md:transition-[grid-template-columns] md:duration-200 md:ease-sidebar motion-reduce:md:transition-none",
          full ? "md:grid-cols-[0px_minmax(0,1fr)]" : "md:grid-cols-[var(--rail)_minmax(0,1fr)]",
          // Without the rail the pane is the only row; left in the `auto` row it
          // would grow to its content and stop scrolling.
          narrowHidden && "max-md:grid-rows-[minmax(0,1fr)]",
        )}
      >
        {/*
        `overflow-hidden` plus the fixed-width inner column keep the rail's
        content from reflowing while the track animates to zero; the rows
        inside keep their own scroll.
      */}
        <aside
          // `inert` follows the wide layout, the one that animates the rail
          // away; below `md` a hidden rail is `display: none` anyway.
          inert={full}
          aria-label={label}
          className={cn(
            "min-h-0 min-w-0 overflow-hidden border-b bg-muted/15 md:border-r md:border-b-0",
            // Stacked on narrow viewports the rail stays expanded: it is
            // navigation, not filters, so hiding it behind a button would bury
            // the only way to switch. Just under half the viewport leaves what
            // is open the larger share; the rows scroll.
            "max-md:max-h-[45dvh]",
            narrowHidden && "max-md:hidden",
            full && "md:border-r-0",
          )}
        >
          <div className="flex h-full min-h-0 flex-col p-3 md:w-[var(--rail)]">{rail}</div>
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
      {collapsedOnNarrow && (
        <Sheet
          open={narrowOpen && isMobile}
          onOpenChange={(open) => setOpenOn(open ? pathname : null)}
        >
          {/* Styled like the Explore filter rail's sheet: the rail at its
              own width over the dimmed page, not a page of its own. */}
          {/* Styled like the Explore filter rail's sheet: the rail at its
              own width over the dimmed page, under the same small heading.
              A tap doesn't focus the search box, which would raise the
              phone's keyboard over the list. */}
          <SheetContent
            side="left"
            className="w-[300px] p-0 sm:max-w-[300px]"
            initialFocus={(openType) => openType !== "touch"}
          >
            {/* Any link closes it, including the page already open, which
                navigates nowhere and so would not close it by path. */}
            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- delegated close for the links inside, which carry their own keyboard handling */}
            <nav
              aria-label={label}
              onClick={(e) => {
                if (e.target instanceof Element && e.target.closest("a")) setOpenOn(null);
              }}
              className="flex h-full min-h-0 flex-col gap-3 bg-muted/15 p-3"
            >
              <SheetTitle className="text-muted-foreground text-[0.6875rem] font-medium tracking-wider uppercase">
                {label}
              </SheetTitle>
              {rail}
            </nav>
          </SheetContent>
        </Sheet>
      )}
    </RailFrameContext.Provider>
  );
}
