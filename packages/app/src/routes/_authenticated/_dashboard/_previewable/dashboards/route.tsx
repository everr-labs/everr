import { cn } from "@everr/ui/lib/utils";
import { createFileRoute, Outlet, useSearch } from "@tanstack/react-router";
import * as z from "zod";
import { DashboardsList } from "@/components/dashboards/dashboards-list";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/dashboards",
)({
  staticData: { fullBleed: true },
  // Full screen hides the dashboard list and gives the whole width to the open
  // dashboard. In the URL so a full-screen dashboard is linkable and survives
  // a reload — a deep link from an alert can land directly on it.
  validateSearch: z.object({
    full: z.boolean().optional().catch(undefined),
  }),
  component: DashboardsLayout,
});

/**
 * The master-detail frame every dashboard renders in, shaped like the Explore
 * rails (Logs, Errors, Traces): a 260px tinted, bordered rail as the first
 * grid column, and the open dashboard as a pane that scrolls itself — the
 * page never scrolls. The in-page list is the only enumeration of Dashboards;
 * the app sidebar keeps a single flat link here.
 */
function DashboardsLayout() {
  const { full } = Route.useSearch();
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });

  // Both directions of the toggle live inside the grid toolbar (`FrameToggle`
  // via DashboardGrid). Full mode keeps the same grid and animates the rail's
  // track to zero — the dashboard slides over instead of snapping.
  return (
    <div
      className={cn(
        "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:transition-[grid-template-columns] md:duration-300 md:ease-out motion-reduce:md:transition-none",
        full
          ? "md:grid-cols-[0px_minmax(0,1fr)]"
          : "md:grid-cols-[260px_minmax(0,1fr)]",
      )}
    >
      {/*
        `overflow-hidden` plus the fixed-width inner column keep the rail's
        content from reflowing while the track animates; the rows inside keep
        their own scroll (DashboardsList).
      */}
      <aside
        inert={full}
        aria-label="Dashboards"
        className={cn(
          "min-h-0 min-w-0 overflow-hidden border-b bg-muted/15 md:border-r md:border-b-0",
          "max-md:max-h-[45dvh]",
          full && "max-md:hidden md:border-r-0",
        )}
      >
        <div className="flex h-full min-h-0 flex-col gap-3 p-3 md:w-[260px]">
          <DashboardsList preview={preview} />
        </div>
      </aside>
      <main className="min-h-0 min-w-0 overflow-auto overscroll-y-contain">
        <div className="p-3">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
