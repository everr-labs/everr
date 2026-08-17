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
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
      <AlertingSectionNavRail />
      <div className="min-w-0 overflow-auto p-3">
        <Outlet />
      </div>
    </div>
  );
}
