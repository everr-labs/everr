import { resolveTimeRange } from "@everr/ui/lib/time-range";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import type { Panel } from "@/data/dashboards/schema";
import { useTimeRange } from "@/hooks/use-time-range";
import { PanelShell } from "../panel-shell";
import { usePanelQueries } from "./use-panel-queries";
import { getVisualizationInset, PanelVisualization } from "./visualizations";

interface DashboardPanelProps {
  panel: Panel;
  panelKey: string;
}

export function DashboardPanel({ panel, panelKey }: DashboardPanelProps) {
  const { display, plugin } = panel.spec;
  const navigate = useNavigate();
  // Effective range: explicit URL params, else the dashboard's route defaults,
  // else the global default — resolved before first render (no flash).
  const { timeRange } = useTimeRange();
  const { from, to } = timeRange;

  const { data, status, errorMessage } = usePanelQueries(panel, { from, to });
  const { fromDate, toDate } = resolveTimeRange(timeRange);

  const handleTimeRangeChange = useCallback(
    (range: { from: Date; to: Date }) => {
      navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          from: range.from.toISOString(),
          to: range.to.toISOString(),
        }),
        replace: false,
      });
    },
    [navigate],
  );

  return (
    <div className="group/panel relative h-full">
      <PanelShell
        title={display?.name ?? panelKey}
        description={display?.description}
        status={status}
        errorMessage={errorMessage}
        className="h-full"
        inset={getVisualizationInset(plugin.kind)}
      >
        <PanelVisualization
          plugin={plugin}
          data={data}
          timeRange={{ from: fromDate, to: toDate }}
          onTimeRangeChange={handleTimeRangeChange}
        />
      </PanelShell>
    </div>
  );
}
