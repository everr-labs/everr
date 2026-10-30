import { DashboardGrid } from "#app/components/dashboards/dashboard-grid.tsx";
import { DashboardProvider } from "#app/components/dashboards/use-dashboard.tsx";
import type { Dashboard } from "#app/data/dashboards/schema.ts";

/**
 * Home renders a built-in (`slug`) from the catalog, so its panels maximize
 * into that built-in's own panel pages in the dashboards frame.
 */
export function DashboardHome({ slug, document }: { slug: string; document: Dashboard }) {
  return (
    <DashboardProvider document={document}>
      <DashboardGrid frameToggle={false} panelFullscreenTo={{ kind: "builtin", slug }} />
    </DashboardProvider>
  );
}
