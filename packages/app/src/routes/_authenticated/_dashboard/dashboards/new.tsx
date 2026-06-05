import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import * as z from "zod";
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

const NewDashboardSearchSchema = z.object({
  folder: z.string().uuid().optional(),
});

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboards/new",
)({
  validateSearch: NewDashboardSearchSchema,
  staticData: { breadcrumb: "New Dashboard" },
  head: () => ({
    meta: [{ title: "Everr - New Dashboard" }],
  }),
  component: NewDashboardPage,
});

function NewDashboardPage() {
  const dashboard = useDashboardStore((s) => s.dashboard);
  const setDashboard = useDashboardStore((s) => s.setDashboard);
  const setEditing = useDashboardStore((s) => s.setEditing);

  useEffect(() => {
    if (!dashboard || dashboard.metadata.name !== "new") {
      setDashboard(EMPTY_DASHBOARD);
    }
    setEditing(true);
  }, [dashboard, setDashboard, setEditing]);

  return <DashboardGrid isNew />;
}
