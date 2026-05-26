import type { Panel } from "@/data/dashboards/types";
import { PanelShell } from "../panel-shell";
import type { QueryResultRow, TimeRange } from "./visualizations";
import { getVisualizationInset, PanelVisualization } from "./visualizations";

interface PanelPreviewProps {
  panel: Panel;
  panelKey: string;
  data?: QueryResultRow[];
  timeRange?: TimeRange;
}

export function PanelPreview({
  panel,
  panelKey,
  data,
  timeRange,
}: PanelPreviewProps) {
  const { display, plugin } = panel.spec;

  return (
    <PanelShell
      title={display.name ?? panelKey}
      description={display.description}
      status="success"
      className="h-full"
      inset={getVisualizationInset(plugin.kind)}
    >
      <PanelVisualization plugin={plugin} data={data} timeRange={timeRange} />
    </PanelShell>
  );
}
