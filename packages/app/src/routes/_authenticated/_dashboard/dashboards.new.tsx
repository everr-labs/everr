import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import type { Dashboard } from "@/data/dashboards/types";

const EMPTY_DASHBOARD: Dashboard = {
  kind: "Dashboard",
  metadata: { name: "" },
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
  const setDashboard = useDashboardStore((s) => s.setDashboard);

  useEffect(() => {
    setDashboard(EMPTY_DASHBOARD);
  }, [setDashboard]);

  return <DashboardGrid isNew />;
}
