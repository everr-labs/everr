import type { Panel } from "@/data/dashboards/types";
import { PanelShell } from "../panel-shell";
import { getVisualizationInset, PanelVisualization } from "./visualizations";

interface PanelPreviewProps {
  panel: Panel;
  panelKey: string;
}

export function PanelPreview({ panel, panelKey }: PanelPreviewProps) {
  const { display, plugin } = panel.spec;

  return (
    <PanelShell
      title={display.name ?? panelKey}
      description={display.description}
      status="success"
      className="h-full"
      inset={getVisualizationInset(plugin.kind)}
    >
      <PanelVisualization plugin={plugin} />
    </PanelShell>
  );
}
