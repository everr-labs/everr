import type { ComponentType } from "react";
import type { PanelPlugin } from "@/data/dashboards/schema";
import { StatChartVisualization } from "./stat-chart/stat-chart-visualization";
import { TableVisualization } from "./table/table-visualization";
import { TimeSeriesChartVisualization } from "./time-series-chart/time-series-chart-visualization";

export type QueryResultRow = Record<string, string | number | boolean | null>;

export interface ResolvedTimeRange {
  from: Date;
  to: Date;
}

export interface VisualizationProps {
  plugin: PanelPlugin;
  data?: QueryResultRow[][];
  timeRange?: ResolvedTimeRange;
  onTimeRangeChange?: (range: ResolvedTimeRange) => void;
}

interface VisualizationEntry {
  component: ComponentType<VisualizationProps>;
  inset?: "default" | "flush-content";
}

const registry: Record<string, VisualizationEntry> = {
  StatChart: {
    component: StatChartVisualization,
  },
  Table: {
    component: TableVisualization,
    inset: "flush-content",
  },
  TimeSeriesChart: {
    component: TimeSeriesChartVisualization,
  },
};

export function getVisualizationInset(
  kind: string,
): "default" | "flush-content" {
  return registry[kind]?.inset ?? "default";
}

export function PanelVisualization({
  plugin,
  data,
  timeRange,
  onTimeRangeChange,
}: VisualizationProps) {
  const entry = registry[plugin.kind];

  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-muted-foreground">
        <p className="text-sm">
          Unknown visualization:{" "}
          <code className="font-mono">{plugin.kind}</code>
        </p>
      </div>
    );
  }

  const Component = entry.component;
  return (
    <Component
      plugin={plugin}
      data={data}
      timeRange={timeRange}
      onTimeRangeChange={onTimeRangeChange}
    />
  );
}
