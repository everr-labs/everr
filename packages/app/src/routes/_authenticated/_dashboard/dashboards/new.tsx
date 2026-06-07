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
  const { folder } = Route.useSearch();
  const dashboard = useDashboardStore((s) => s.dashboard);
  const sourceSlug = useDashboardStore((s) => s.sourceSlug);
  const setDashboard = useDashboardStore((s) => s.setDashboard);
  const setEditing = useDashboardStore((s) => s.setEditing);

  useEffect(() => {
    // Re-seed when the store is empty or holds a SAVED dashboard
    // (sourceSlug !== null). A draft survives — even with an edited
    // metadata.name (the slug is user-editable via the settings JSON section).
    if (!dashboard || sourceSlug !== null) {
      setDashboard(EMPTY_DASHBOARD, { draft: true });
    }
    setEditing(true);
  }, [dashboard, sourceSlug, setDashboard, setEditing]);

  return <DashboardGrid isNew defaultFolderId={folder ?? null} />;
}
