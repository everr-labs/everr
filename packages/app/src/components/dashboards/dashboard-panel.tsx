import { Button } from "@everr/ui/components/button";
import { resolveTimeRange, withTimeRange } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { useCallback } from "react";
import type { Panel } from "@/data/dashboards/schema";
import { PanelShell } from "../panel-shell";
import { usePanelQueries } from "./use-panel-queries";
import { getVisualizationInset, PanelVisualization } from "./visualizations";

interface DashboardPanelProps {
  panel: Panel;
  panelKey: string;
  dashboardId: string;
  isEditing: boolean;
  onRemove?: () => void;
  onDuplicate?: () => void;
}

export function DashboardPanel({
  panel,
  panelKey,
  dashboardId,
  isEditing,
  onRemove,
  onDuplicate,
}: DashboardPanelProps) {
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
      className={cn(
        "group/panel relative h-full",
        isEditing && "drag-handle cursor-grab active:cursor-grabbing",
      )}
      style={{ viewTransitionName: `panel-${panelKey}` }}
    >
      {isEditing && (
        <div className="absolute top-0 left-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 cursor-default items-center rounded-md border border-border bg-card px-1 py-0.5 shadow-sm opacity-0 transition-opacity group-hover/panel:opacity-100">
          <Button
            variant="ghost"
            size="icon-xs"
            className="cursor-pointer"
            render={
              <Link
                to="/dashboards/$dashboardId/panel/$panelKey"
                params={{ dashboardId, panelKey }}
                search={(prev) => ({ ...prev, vars: prev.vars })}
              />
            }
            aria-label="Edit panel"
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="cursor-pointer"
            onClick={onDuplicate}
            aria-label="Duplicate panel"
          >
            <Copy />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="cursor-pointer"
            onClick={onRemove}
            aria-label="Remove panel"
          >
            <Trash2 />
          </Button>
        </div>
      )}
      <PanelShell
        title={display.name ?? panelKey}
        description={display.description}
        status={status}
        errorMessage={errorMessage}
        className={cn("h-full", isEditing && "pointer-events-none")}
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
