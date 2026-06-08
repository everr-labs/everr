import { createFileRoute, notFound } from "@tanstack/react-router";
import { DashboardNotFound } from "@/components/dashboards/dashboard-not-found";
import { DashboardSettingsPage } from "@/components/dashboards/dashboard-settings-page";
import { dashboardOptions } from "@/data/dashboards/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboards/$dashboardId_/settings",
)({
  staticData: { breadcrumb: "Settings", fullBleed: true },
  head: () => ({
    meta: [{ title: "Everr - Dashboard Settings" }],
  }),
  component: DashboardSettingsRoute,
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

function DashboardSettingsRoute() {
  const { dashboardId } = Route.useParams();
  return <DashboardSettingsPage dashboardId={dashboardId} />;
}
