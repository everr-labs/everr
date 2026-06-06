import { createFileRoute } from "@tanstack/react-router";
import { DashboardSettingsPage } from "@/components/dashboards/dashboard-settings-page";
import { dashboardOptions } from "@/data/dashboards/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboards/$dashboardId_/settings",
)({
  staticData: { breadcrumb: "Settings" },
  head: () => ({
    meta: [{ title: "Everr - Dashboard Settings" }],
  }),
  component: DashboardSettingsRoute,
  loader: async ({ context: { queryClient }, params: { dashboardId } }) => {
    if (dashboardId !== "new") {
      await queryClient.prefetchQuery(dashboardOptions(dashboardId));
    }
  },
});

function DashboardSettingsRoute() {
  const { dashboardId } = Route.useParams();
  return <DashboardSettingsPage dashboardId={dashboardId} />;
}
