import { Tooltip, TooltipContent, TooltipTrigger } from "@everr/ui/components/tooltip";
import { useNavigate } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useMemo, useRef } from "react";
import type { Panel } from "#app/data/dashboards/schema.ts";
import { PanelShell } from "../panel-shell";
import { useDashboardPanelData } from "./use-dashboard-panel-data";
import { useInView } from "./use-in-view";
import {
  getVisualizationInset,
  getVisualizationSpecWarnings,
  PanelVisualization,
} from "./visualizations";
import { parseSpecLenient } from "./visualizations/parse-spec";
import { statChartSpec } from "./visualizations/stat-chart/spec";
import {
  resolveStatTileColor,
  STAT_BACKGROUND_GRADIENT,
} from "./visualizations/stat-chart/stat-colors";
import { computeStatTiles } from "./visualizations/stat-chart/stat-series";

interface DashboardPanelProps {
  panel: Panel;
  panelKey: string;
  /** Extra header action rendered next to the spec-warnings indicator. */
  action?: ReactNode;
}

function SpecWarningsIndicator({ warnings }: { warnings: string[] }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="text-amber-500 hover:text-amber-400"
            aria-label="Invalid panel options"
          />
        }
      >
        <TriangleAlert className="size-4" />
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        <p className="mb-1 font-medium">Invalid panel options ignored (defaults used):</p>
        <ul className="list-disc space-y-0.5 pl-4">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

export function DashboardPanel({ panel, panelKey, action }: DashboardPanelProps) {
  const { display, plugin } = panel.spec;
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(containerRef);

  const { data, status, errorMessage, timeRange } = useDashboardPanelData(panel, {
    enabled: inView,
  });

  const specWarnings = useMemo(() => getVisualizationSpecWarnings(plugin), [plugin]);
  const statBackground = useMemo(() => {
    if (plugin.kind !== "StatChart" || !data || status !== "success") return undefined;
    const spec = parseSpecLenient(statChartSpec, plugin.spec).spec;
    if (spec.colorMode !== "background") return undefined;
    const tiles = computeStatTiles(data, spec.calculation);
    return tiles.length === 1 && tiles[0]
      ? resolveStatTileColor(tiles[0], spec.thresholds)
      : undefined;
  }, [data, plugin, status]);

  const handleTimeRangeChange = useCallback(
    (range: { from: Date; to: Date }) => {
      void navigate({
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
    <div ref={containerRef} className="group/panel relative h-full">
      <PanelShell
        title={display?.name ?? panelKey}
        description={display?.description}
        status={status}
        errorMessage={errorMessage}
        className="h-full"
        style={
          statBackground
            ? { backgroundColor: statBackground, backgroundImage: STAT_BACKGROUND_GRADIENT }
            : undefined
        }
        headerClassName={
          statBackground
            ? "text-white [&_button]:text-white/80 [&_button:hover]:text-white"
            : undefined
        }
        inset={getVisualizationInset(plugin.kind)}
        action={
          action || specWarnings.length > 0 ? (
            <div className="flex items-center gap-1.5">
              {specWarnings.length > 0 && <SpecWarningsIndicator warnings={specWarnings} />}
              {action}
            </div>
          ) : undefined
        }
      >
        <PanelVisualization
          plugin={plugin}
          data={data}
          timeRange={timeRange}
          onTimeRangeChange={handleTimeRangeChange}
        />
      </PanelShell>
    </div>
  );
}
