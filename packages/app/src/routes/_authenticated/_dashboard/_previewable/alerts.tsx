import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AlertingSectionNavRail } from "./alerts/-components/section-nav";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts",
)({
  staticData: { breadcrumb: "Alerting", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Alerting" }] }),
  component: AlertingSectionLayout,
});

function AlertingSectionLayout() {
  return (
    <div
      // `_previewable.tsx` renders every route here inside `PageContainer`,
      // which is a flex column carrying `flex-1 min-h-0`, the same idiom the
      // Explore layout and the explorer grids (e.g. error-issues.tsx) use to
      // size themselves. That lets this grid take its height from the real
      // ancestor chain (viewport minus topnav minus whatever banners are
      // showing) instead of computing it, so a banner above this layout just
      // shrinks the space the grid is handed rather than being invisible to a
      // fixed calculation. `lg:-m-3` cancels the inherited padding at the
      // rail breakpoint so the rail sits flush against the sidebar.
      className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:-m-3 lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]"
    >
      <AlertingSectionNavRail />
      <div className="min-w-0 overflow-auto p-3">
        <Outlet />
      </div>
    </div>
  );
}
