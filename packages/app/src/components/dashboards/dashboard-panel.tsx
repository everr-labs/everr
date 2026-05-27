import { Button } from "@everr/ui/components/button";
import { resolveTimeRange, withTimeRange } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { useCallback } from "react";
import { panelQueryOptions } from "@/data/dashboards/options";
import type { Panel } from "@/data/dashboards/schema";
import { PanelShell } from "../panel-shell";
import { getVisualizationInset, PanelVisualization } from "./visualizations";

function getPanelQuerySql(panel: Panel): string {
  const query = panel.spec.queries?.[0];
  if (!query) return "";
  const spec = query.spec.plugin.spec;
  return typeof spec.query === "string" ? spec.query : "";
}

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
  const sql = getPanelQuerySql(panel);
  const { data: queryResult, isPending } = useQuery(
    panelQueryOptions(sql, from, to),
  );
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

  const status = sql && isPending ? "pending" : "success";

  return (
    <div
      className={cn(
        "relative h-full",
        isEditing && "drag-handle cursor-grab active:cursor-grabbing",
      )}
    >
      {isEditing && (
        <div className="absolute top-0 left-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-md border border-border bg-card px-1 py-0.5 shadow-sm">
          <Button
            variant="ghost"
            size="icon-xs"
            className="cursor-pointer"
            render={
              <Link
                to="/dashboards/$dashboardId/panel/$panelKey"
                params={{ dashboardId, panelKey }}
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
        className={cn("h-full", isEditing && "pointer-events-none")}
        inset={getVisualizationInset(plugin.kind)}
      >
        <PanelVisualization
          plugin={plugin}
          data={queryResult?.rows}
          timeRange={{ from: fromDate, to: toDate }}
          onTimeRangeChange={handleTimeRangeChange}
        />
      </PanelShell>
    </div>
  );
}
