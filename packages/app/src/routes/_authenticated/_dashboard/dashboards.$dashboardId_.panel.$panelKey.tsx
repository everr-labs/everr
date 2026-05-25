import { createFileRoute } from "@tanstack/react-router";
import { PanelEditPage } from "@/components/dashboards/panel-edit-page";
import { dashboardOptions } from "@/data/dashboards/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboards/$dashboardId_/panel/$panelKey",
)({
  staticData: { breadcrumb: "Edit Panel", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Edit Panel" }],
  }),
  component: PanelEditRoute,
  loader: async ({ context: { queryClient }, params: { dashboardId } }) => {
    await queryClient.prefetchQuery(dashboardOptions(dashboardId));
  },
});

function PanelEditRoute() {
  const { dashboardId, panelKey } = Route.useParams();
  return <PanelEditPage dashboardId={dashboardId} panelKey={panelKey} />;
}
