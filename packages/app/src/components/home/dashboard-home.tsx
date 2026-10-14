import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import { DashboardProvider } from "@/components/dashboards/use-dashboard";
import type { Dashboard } from "@/data/dashboards/schema";

export function DashboardHome({ document }: { document: Dashboard }) {
  return (
    <DashboardProvider document={document}>
      <DashboardGrid frameToggle={false} />
    </DashboardProvider>
  );
}
