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
      // `_previewable.tsx` renders every route here inside `PageContainer`
      // (padded, and not itself a flex/grid box), unlike the Explore layout
      // this rail mirrors, which is a bare flex column. That leaves two gaps
      // at the `lg` (rail) breakpoint: the inherited padding insets the rail
      // from the content edge, and `minmax(0,1fr)` has no definite parent
      // height to size against, so the row shrinks to its content instead of
      // running full height. `lg:-m-3` cancels the inherited padding and
      // `lg:h-[calc(100dvh-3rem)]` (3rem is the fixed topnav's height, see
      // `_dashboard.tsx`) gives the grid a real height to size its row
      // against; `lg:flex-none` stops `flex-1`'s zero flex-basis from
      // overriding that explicit height.
      className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:-m-3 lg:h-[calc(100dvh-3rem)] lg:flex-none lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]"
    >
      <AlertingSectionNavRail />
      <div className="min-w-0 overflow-auto p-3">
        <Outlet />
      </div>
    </div>
  );
}
