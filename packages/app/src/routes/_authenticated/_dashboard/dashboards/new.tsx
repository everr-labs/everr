import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import type { Dashboard } from "@/data/dashboards/schema";

const EMPTY_DASHBOARD: Dashboard = {
  kind: "Dashboard",
  metadata: { name: "new" },
  spec: {
    display: { name: "New Dashboard" },
    panels: {},
    layouts: [{ kind: "Grid", spec: { items: [] } }],
  },
};

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboards/new",
)({
  staticData: { breadcrumb: "New Dashboard" },
  head: () => ({
    meta: [{ title: "Everr - New Dashboard" }],
  }),
  component: NewDashboardPage,
});

function NewDashboardPage() {
  const dashboard = useDashboardStore((s) => s.dashboard);
  const setDashboard = useDashboardStore((s) => s.setDashboard);

  useEffect(() => {
    if (!dashboard || dashboard.metadata.name !== "new") {
      setDashboard(EMPTY_DASHBOARD);
    }
  }, [dashboard, setDashboard]);

  return <DashboardGrid isNew />;
}
