import type { Panel } from "#app/data/dashboards/schema.ts";
import { DashboardPanel } from "./dashboard-panel";
import { DashboardToolbar } from "./dashboard-toolbar";

/**
 * The full-screen view of a single panel: the shell's shared chrome stays
 * around it (rail, breadcrumb, time picker from the dashboard layout, and
 * the variable bar so panel variables stay adjustable) and the panel fills
 * the pane's height. Same toolbar as the grid, so the controls you were using
 * on the dashboard stay exactly where they were.
 */
export function DashboardPanelPage({ panel, panelKey }: { panel: Panel; panelKey: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DashboardToolbar />
      <div className="min-h-0 flex-1">
        <DashboardPanel panel={panel} panelKey={panelKey} />
      </div>
    </div>
  );
}
