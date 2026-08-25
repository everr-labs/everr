import { Button } from "@everr/ui/components/button";
import { Sheet, SheetContent, SheetTitle } from "@everr/ui/components/sheet";
import { useMediaQuery } from "@everr/ui/hooks/use-media-query";
import { Link } from "@tanstack/react-router";
import { BellOff, Flame, Menu, Send, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

const DESTINATIONS = [
  { to: "/alerts", label: "Triage", icon: Flame, exact: true },
  {
    to: "/alerts/rules",
    label: "All Rules",
    icon: SlidersHorizontal,
    exact: false,
  },
  {
    to: "/alerts/silences",
    label: "Silences",
    icon: BellOff,
    exact: false,
  },
  {
    to: "/alerts/notifications",
    label: "Notifications",
    icon: Send,
    exact: false,
  },
] as const;

// The same width as the `lg:` column rules on the Explore grids. Below it
// there is no room for a 260px rail next to the page, so it moves into a
// sheet behind a button.
const NARROW_QUERY = "(max-width: 1023px)";

/** The shell mirrors the Explore filter rail
 *  (packages/telemetry-explorer/src/filters/ui/filter-sidebar.tsx), which is
 *  the source of truth for how a rail looks in this app. Not exported: only
 *  `AlertingSectionNavRail` places it, and an export with no consumer outside
 *  this file reads as dead code. */
function AlertingSectionNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav
      aria-label="Alerting"
      className="bg-muted/15 flex h-full min-h-0 flex-col gap-3 overflow-auto border-b p-3 lg:border-r lg:border-b-0"
    >
      <ul className="flex flex-col gap-0.5">
        {DESTINATIONS.map((d) => (
          <li key={d.to}>
            <Link
              to={d.to}
              activeOptions={{ exact: d.exact }}
              activeProps={{ "data-active": "true" }}
              onClick={onNavigate}
              className="group flex min-h-9 items-center gap-2 rounded px-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground data-active:bg-accent data-active:font-medium data-active:text-accent-foreground"
            >
              <d.icon
                aria-hidden
                className="size-3.5 shrink-0 group-data-active:text-primary"
              />
              {d.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Places the section nav in one of two positions: the first column of the
 * layout grid on a wide window, or behind a button that opens the same nav in
 * a sheet on a narrow one.
 *
 * The nav is built once, in one JSX subtree, so it never renders twice at
 * once. Two copies would give two elements the same accessible name, break
 * the active-link assertions, and repeat the nav for a screen reader.
 */
export function AlertingSectionNavRail() {
  const isNarrow = useMediaQuery(NARROW_QUERY);
  const [open, setOpen] = useState(false);
  // Only the sheet needs to close itself on navigation; the wide rail is not
  // a dismissible overlay, so it gets no handler.
  const nav = (
    <AlertingSectionNav
      onNavigate={isNarrow ? () => setOpen(false) : undefined}
    />
  );

  if (!isNarrow) return nav;

  return (
    <div className="bg-muted/15 flex items-center border-b px-3 py-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Menu />
        Alerting
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[300px] p-0 sm:max-w-[300px]">
          <SheetTitle className="sr-only">Alerting</SheetTitle>
          {nav}
        </SheetContent>
      </Sheet>
    </div>
  );
}
