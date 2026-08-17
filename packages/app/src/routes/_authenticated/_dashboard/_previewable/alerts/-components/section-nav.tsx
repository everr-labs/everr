import { Button } from "@everr/ui/components/button";
import { Sheet, SheetContent, SheetTitle } from "@everr/ui/components/sheet";
import { useMediaQuery } from "@everr/ui/hooks/use-media-query";
import { Link } from "@tanstack/react-router";
import { BellRing, Menu } from "lucide-react";
import { useState } from "react";

const DESTINATIONS = [
  { to: "/alerts", label: "Triage", exact: true },
  { to: "/alerts/rules", label: "All Rules", exact: false },
  { to: "/alerts/silences", label: "Silences", exact: false },
  { to: "/alerts/notifications", label: "Notifications", exact: false },
  { to: "/alerts/routing", label: "Routing", exact: false },
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
function AlertingSectionNav() {
  return (
    <nav
      aria-label="Alerting"
      className="bg-muted/15 flex h-full min-h-0 flex-col gap-3 overflow-auto border-b p-3 lg:border-r lg:border-b-0"
    >
      <div className="text-muted-foreground flex items-center gap-2 text-[0.6875rem] font-medium tracking-wider uppercase">
        <BellRing className="size-3.5" />
        Alerting
      </div>
      <ul className="flex flex-col gap-0.5">
        {DESTINATIONS.map((d) => (
          <li key={d.to}>
            <Link
              to={d.to}
              activeOptions={{ exact: d.exact }}
              activeProps={{ "data-active": "true" }}
              className="flex min-h-9 items-center rounded px-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground data-active:bg-accent data-active:font-medium data-active:text-accent-foreground"
            >
              {d.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Places the section nav in one of two positions: as the first column of the
 * layout grid on a wide window, or behind a button that opens the same nav in
 * a sheet on a narrow one. The nav is built once, in one JSX subtree, so it
 * never renders twice at once (which would give two elements the same
 * accessible name and break the active-link assertions, plus double up for
 * anyone using a screen reader).
 */
export function AlertingSectionNavRail() {
  const isNarrow = useMediaQuery(NARROW_QUERY);
  const [open, setOpen] = useState(false);
  const nav = <AlertingSectionNav />;

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
