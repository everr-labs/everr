import { resolveTimeRange, withTimeRange } from "@everr/ui/lib/time-range";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";
import type { Panel } from "@/data/dashboards/schema";
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
  const search = useSearch({ from: "/_authenticated/_dashboard" });
  const { from, to } = search;

  const { data, status, errorMessage } = usePanelQueries(panel, { from, to });
  const { fromDate, toDate } = resolveTimeRange(withTimeRange(search));

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
    <div
      className="group/panel relative h-full"
      style={{ viewTransitionName: `panel-${panelKey}` }}
    >
      <PanelShell
        title={display.name ?? panelKey}
        description={display.description}
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
