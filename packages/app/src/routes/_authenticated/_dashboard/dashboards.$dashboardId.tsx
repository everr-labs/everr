import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import { dashboardOptions } from "@/data/dashboards/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboards/$dashboardId",
)({
  staticData: { breadcrumb: "Dashboard" },
  head: () => ({
    meta: [{ title: "Everr - Dashboard" }],
  }),
  component: DashboardPage,
  loader: async ({ context: { queryClient }, params: { dashboardId } }) => {
    await queryClient.prefetchQuery(dashboardOptions(dashboardId));
  },
});

function DashboardPage() {
  const { dashboardId } = Route.useParams();
  const { data: dashboard } = useSuspenseQuery(dashboardOptions(dashboardId));
  return <DashboardGrid dashboard={dashboard} />;
}
