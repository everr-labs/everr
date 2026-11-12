import { notFound } from "@tanstack/react-router";
import { DashboardPanel } from "./dashboard-panel";
import { DashboardToolbar } from "./dashboard-toolbar";
import { type DashboardAddress, DashboardLink, RestorePanelLink } from "./panel-links";
import { useDashboard } from "./use-dashboard";

/**
 * One panel of the dashboard in context, filling the pane under the same
 * toolbar the grid has. The floor keeps it readable where the pane is short
 * (the rail stacked above it on a narrow viewport); the pane scrolls then.
 */
export function MaximizedPanel({
  address,
  panelKey,
}: {
  address: DashboardAddress;
  panelKey: string;
}) {
  const panel = useDashboard().spec.panels[panelKey];
  // The route loader already 404s unknown keys; this only narrows the type.
  if (!panel) throw notFound();
  return (
    <div className="flex h-full min-h-96 flex-col">
      <DashboardToolbar />
      <div className="min-h-0 flex-1">
        <DashboardPanel
          panel={panel}
          panelKey={panelKey}
          action={<RestorePanelLink address={address} />}
        />
      </div>
    </div>
  );
}

/** Shown when a maximized-panel route names a panel the dashboard doesn't have. */
export function PanelNotFound({ address }: { address: DashboardAddress }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <p className="text-lg">Panel not found</p>
      <DashboardLink address={address} className="text-sm underline">
        Back to the dashboard
      </DashboardLink>
    </div>
  );
}
