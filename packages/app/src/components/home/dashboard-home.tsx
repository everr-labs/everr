import { DashboardGrid } from "#app/components/dashboards/dashboard-grid.tsx";
import { DashboardProvider } from "#app/components/dashboards/use-dashboard.tsx";
import type { Dashboard } from "#app/data/dashboards/schema.ts";

export function DashboardHome({
  document,
  builtinSlug,
}: {
  document: Dashboard;
  /** The built-in this document is, so its panels can open maximized there. */
  builtinSlug: string;
}) {
  return (
    <DashboardProvider document={document}>
      <DashboardGrid address={{ kind: "built-in", slug: builtinSlug }} frameToggle={false} />
    </DashboardProvider>
  );
}
