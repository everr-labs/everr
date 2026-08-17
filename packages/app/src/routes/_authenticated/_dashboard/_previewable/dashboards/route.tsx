import { Button } from "@everr/ui/components/button";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { PanelLeftClose } from "lucide-react";
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
  const navigate = useNavigate();

  const setFull = (value: boolean) =>
    // `to: "."` keeps the open dashboard: resolving from this layout instead
    // would land on the index, whose redirect swaps the dashboard under the
    // toggle. `replace`: toggling the frame is a view change, not a place the
    // back button should revisit.
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, full: value || undefined }),
      replace: true,
    });

  // In full mode the restore control lives inside the grid toolbar
  // (`FrameRestore` via DashboardGrid's `leading` slot), so the layout adds
  // no chrome of its own.
  if (full) return <Outlet />;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      {/*
        The list is a navigation rail: it must hold still while the dashboard
        scrolls. Sticky only engages when the element fits the viewport, so the
        rail caps its height (viewport minus the app header and page insets)
        and scrolls its own overflow; only the tree and rows scroll, the
        heading and search stay pinned.
      */}
      <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-4.5rem)]">
        <div className="flex items-center justify-between gap-2">
          <h1 className="px-1 text-lg font-semibold">Dashboards</h1>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Hide the dashboard list"
            onClick={() => setFull(true)}
            className="text-muted-foreground"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
        <DashboardsList preview={preview} />
      </aside>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
