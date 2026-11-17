import { ScrollArea } from "@everr/ui/components/scroll-area";
import { SideDrawer } from "@everr/ui/components/side-drawer";
import { useIsMobile } from "@everr/ui/hooks/use-mobile";
import { cn } from "@everr/ui/lib/utils";
import { useMatches } from "@tanstack/react-router";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import * as z from "zod";
import { useOnNavigate } from "#app/hooks/use-on-navigate.ts";

/**
 * What the pane's `FrameToggle` does: on a phone, where the rail is a drawer,
 * `drawer` is set and the toggle opens it; otherwise it flips `full`.
 */
interface RailFrameState {
  drawer: boolean;
  openDrawer: () => void;
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
  // Below `md` the rail of a page that shows a `FrameToggle` (`railToggle` in
  // its route's static data) leaves the layout and opens as a drawer from the
  // toggle. Elsewhere it stacks above the pane, the only way back to it.
  const collapsible = useMatches({
    select: (matches) =>
      matches.some((match) => match.staticData.railToggle && match.status === "success"),
  });
  // Only decides whether the drawer may show: the layout hides the rail with
  // CSS, so the server markup is already right on a phone.
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerNavRef = useRef<HTMLElement>(null);
  // Picking a row is done with the list, and so is any other navigation.
  useOnNavigate(() => setDrawerOpen(false));
  const drawer = collapsible && isMobile;
  const frame = useMemo(() => ({ drawer, openDrawer: () => setDrawerOpen(true) }), [drawer]);
  return (
    <RailFrameContext.Provider value={frame}>
      <div
        className={cn(
          "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] [--rail:260px] md:grid-rows-[minmax(0,1fr)] md:transition-[grid-template-columns] md:duration-200 md:ease-sidebar motion-reduce:md:transition-none",
          full ? "md:grid-cols-[0px_minmax(0,1fr)]" : "md:grid-cols-[var(--rail)_minmax(0,1fr)]",
          // Without the rail the pane is the only row; left in the `auto` row it
          // would grow to its content and stop scrolling.
          collapsible && "max-md:grid-rows-[minmax(0,1fr)]",
        )}
      >
        {/*
        `overflow-hidden` plus the fixed-width inner column keep the rail's
        content from reflowing while the track animates to zero; the rows
        inside keep their own scroll.
      */}
        <aside
          // `inert` follows the wide layout, the one that animates the rail
          // away. On a phone `full` doesn't hide it: a stacked rail stays
          // usable, and a drawer rail is `display: none` anyway.
          inert={full && !isMobile}
          aria-label={label}
          className={cn(
            "min-h-0 min-w-0 overflow-hidden border-b bg-pane md:border-r md:border-b-0",
            // Stacked (no toggle to bring it back) it stays expanded below
            // `md`: just under half the viewport leaves what is open the
            // larger share; the rows scroll.
            "max-md:max-h-[45dvh]",
            collapsible && "max-md:hidden",
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
      {collapsible && (
        // The same drawer as the app sidebar and the Explore filter rail.
        // Focus lands on the list itself, never the search box, which would
        // raise the phone's keyboard over it. The toggle opens the drawer
        // from code, so Base UI can't tell a tap from a click.
        <SideDrawer
          open={drawerOpen && isMobile}
          onOpenChange={setDrawerOpen}
          title={label}
          closeLabel={`Close the ${label.toLowerCase()} list`}
          className="[--drawer-bleed-background:var(--color-pane)]"
          initialFocus={drawerNavRef}
        >
          <nav
            ref={drawerNavRef}
            tabIndex={-1}
            aria-label={label}
            className="outline-none flex h-full min-h-0 flex-col gap-3 px-3 pb-3"
          >
            {rail}
          </nav>
        </SideDrawer>
      )}
    </RailFrameContext.Provider>
  );
}
