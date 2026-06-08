import { createFileRoute, notFound } from "@tanstack/react-router";
import { DashboardNotFound } from "@/components/dashboards/dashboard-not-found";
import { PanelEditPage } from "@/components/dashboards/panel-edit-page";
import { dashboardOptions } from "@/data/dashboards/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboards/$dashboardId_/panel/$panelKey",
)({
  staticData: { breadcrumb: "Edit Panel", fullBleed: true },
  head: () => ({
    meta: [{ title: "Everr - Edit Panel" }],
  }),
  component: PanelEditRoute,
  notFoundComponent: DashboardNotFound,
  loader: async ({ context: { queryClient }, params: { dashboardId } }) => {
    if (dashboardId !== "new") {
      try {
        await queryClient.ensureQueryData(dashboardOptions(dashboardId));
      } catch {
        throw notFound();
      }
    }
  },
});

function PanelEditRoute() {
  const { dashboardId, panelKey } = Route.useParams();
  return <PanelEditPage dashboardId={dashboardId} panelKey={panelKey} />;
}
