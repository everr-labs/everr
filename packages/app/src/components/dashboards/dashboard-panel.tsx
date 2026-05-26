import { Button } from "@everr/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { Pencil, X } from "lucide-react";
import { panelQueryOptions } from "@/data/dashboards/options";
import type { Panel } from "@/data/dashboards/types";
import { resolveTimeRange, withTimeRange } from "@/lib/time-range";
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
}

export function DashboardPanel({
  panel,
  panelKey,
  dashboardId,
  isEditing,
  onRemove,
}: DashboardPanelProps) {
  const { display, plugin } = panel.spec;
  const search = useSearch({ from: "/_authenticated/_dashboard" });
  const { from, to } = search;
  const sql = getPanelQuerySql(panel);
  const { data: queryResult, isPending } = useQuery(
    panelQueryOptions(sql, from, to),
  );
  const { fromDate, toDate } = resolveTimeRange(withTimeRange(search));

  const status = sql && isPending ? "pending" : "success";

  return (
    <PanelShell
      title={display.name ?? panelKey}
      description={display.description}
      status={status}
      className="h-full"
      inset={getVisualizationInset(plugin.kind)}
      headerClassName={
        isEditing ? "drag-handle cursor-grab active:cursor-grabbing" : undefined
      }
      action={
        isEditing ? (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
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
              onClick={onRemove}
              aria-label="Remove panel"
            >
              <X />
            </Button>
          </div>
        ) : undefined
      }
    >
      <PanelVisualization
        plugin={plugin}
        data={queryResult?.rows}
        timeRange={{ from: fromDate, to: toDate }}
      />
    </PanelShell>
  );
}
