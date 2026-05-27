import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import { dashboardOptions } from "@/data/dashboards/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboards/$dashboardId",
)({
  staticData: {
    breadcrumb: (match: { loaderData?: { name: string } }) => [
      { label: "Dashboards", to: "/dashboards" },
      { label: match.loaderData?.name ?? "Dashboard" },
    ],
  },
  head: () => ({
    meta: [{ title: "Everr - Dashboard" }],
  }),
  component: DashboardPage,
  notFoundComponent: DashboardNotFound,
  loader: async ({ context: { queryClient }, params: { dashboardId } }) => {
    try {
      const dashboard = await queryClient.ensureQueryData(
        dashboardOptions(dashboardId),
      );
      return { name: dashboard.spec.display?.name ?? dashboardId };
    } catch {
      throw notFound();
    }
  },
});

function DashboardNotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <p className="text-lg">Dashboard not found</p>
      <Link to="/dashboards" className="text-sm underline">
        Back to dashboards
      </Link>
    </div>
  );
}

function DashboardPage() {
  const { dashboardId } = Route.useParams();
  const { data } = useSuspenseQuery(dashboardOptions(dashboardId));
  const setDashboard = useDashboardStore((s) => s.setDashboard);
  const dashboard = useDashboardStore((s) => s.dashboard);

  useEffect(() => {
    if (!dashboard || dashboard.metadata.name !== data.metadata.name) {
      setDashboard(data);
    }
  }, [data, dashboard, setDashboard]);

  if (!dashboard) return null;

  return <DashboardGrid />;
}
