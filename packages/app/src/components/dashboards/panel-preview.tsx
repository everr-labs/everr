import type { Panel } from "@/data/dashboards/schema";
import { PanelShell } from "../panel-shell";
import type { QueryResultRow, ResolvedTimeRange } from "./visualizations";
import { getVisualizationInset, PanelVisualization } from "./visualizations";

interface PanelPreviewProps {
  panel: Panel;
  panelKey: string;
  data?: QueryResultRow[];
  timeRange?: ResolvedTimeRange;
  onTimeRangeChange?: (range: ResolvedTimeRange) => void;
}

export function PanelPreview({
  panel,
  panelKey,
  data,
  timeRange,
  onTimeRangeChange,
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
      <PanelVisualization
        plugin={plugin}
        data={data}
        timeRange={timeRange}
        onTimeRangeChange={onTimeRangeChange}
      />
    </PanelShell>
  );
}
