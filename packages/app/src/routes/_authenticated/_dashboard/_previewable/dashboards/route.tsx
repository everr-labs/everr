import { cn } from "@everr/ui/lib/utils";
import { createFileRoute, Outlet, useSearch } from "@tanstack/react-router";
import * as z from "zod";
import { DashboardsList } from "@/components/dashboards/dashboards-list";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/dashboards",
)({
  // Full screen hides the dashboard list and gives the whole width to the open
  // dashboard. In the URL so a full-screen dashboard is linkable and survives
  // a reload — a deep link from an alert can land directly on it.
  validateSearch: z.object({
    full: z.boolean().optional().catch(undefined),
  }),
  component: DashboardsLayout,
});

/**
 * The master-detail frame every dashboard renders in: one list on the left —
 * "Your dashboards" then "Built-in dashboards" — and the open dashboard on
 * the right. The in-page list is the only enumeration of Dashboards; the app
 * sidebar keeps a single flat link here.
 */
function DashboardsLayout() {
  const { full } = Route.useSearch();
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });

  // Both directions of the toggle live inside the grid toolbar (`FrameToggle`
  // via DashboardGrid's `leading` slot), so the layout adds no chrome of its
  // own in either mode. Full mode keeps the same grid and animates the rail's
  // track to zero — the dashboard slides over instead of snapping.
  return (
    <div
      className={cn(
        "items-start md:grid md:transition-[grid-template-columns,gap] md:duration-300 md:ease-out motion-reduce:md:transition-none",
        full
          ? "gap-0 md:grid-cols-[0rem_minmax(0,1fr)]"
          : "gap-6 md:grid-cols-[20rem_minmax(0,1fr)]",
      )}
    >
      {/*
        The list is a navigation rail: it must hold still while the dashboard
        scrolls. Sticky only engages when the element fits the viewport, so the
        rail caps its height (viewport minus the app header and page insets)
        and scrolls its own overflow; only the tree and rows scroll, the
        heading and search stay pinned. `overflow-hidden` plus the fixed-width
        inner column keep the content from reflowing while the track animates.
      */}
      <aside
        inert={full}
        className={cn(
          "flex min-w-0 flex-col md:sticky md:top-0 md:max-h-[calc(100dvh-4.5rem)] md:overflow-hidden",
          full && "max-md:hidden",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:w-80">
          <h1 className="px-1 text-lg font-semibold">Dashboards</h1>
          <DashboardsList preview={preview} />
        </div>
      </aside>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
