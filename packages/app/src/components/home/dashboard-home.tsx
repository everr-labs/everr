import { DashboardGrid } from "#app/components/dashboards/dashboard-grid.tsx";
import { DashboardProvider } from "#app/components/dashboards/use-dashboard.tsx";
import type { Dashboard } from "#app/data/dashboards/schema.ts";

export function DashboardHome({ document }: { document: Dashboard }) {
  return (
    <DashboardProvider document={document}>
      <DashboardGrid frameToggle={false} />
    </DashboardProvider>
  );
}
