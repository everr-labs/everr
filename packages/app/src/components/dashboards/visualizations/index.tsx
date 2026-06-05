import type { ComponentType } from "react";
import type { PanelPlugin } from "@/data/dashboards/schema";
import { StatChartSettings } from "./stat-chart/stat-chart-settings";
import { StatChartVisualization } from "./stat-chart/stat-chart-visualization";
import { TableSettings } from "./table/table-settings";
import { TableVisualization } from "./table/table-visualization";
import { TimeSeriesChartSettings } from "./time-series-chart/time-series-chart-settings";
import { TimeSeriesChartVisualization } from "./time-series-chart/time-series-chart-visualization";

export type QueryResultRow = Record<string, string | number | boolean | null>;

export interface ResolvedTimeRange {
  from: Date;
  to: Date;
}

export interface VisualizationProps {
  plugin: PanelPlugin;
  data?: QueryResultRow[];
  timeRange?: ResolvedTimeRange;
  onTimeRangeChange?: (range: ResolvedTimeRange) => void;
}

export interface VisualizationSettingsProps {
  spec: Record<string, unknown>;
  onChange: (spec: Record<string, unknown>) => void;
}

interface VisualizationEntry {
  component: ComponentType<VisualizationProps>;
  settings?: ComponentType<VisualizationSettingsProps>;
  inset?: "default" | "flush-content";
}

const registry: Record<string, VisualizationEntry> = {
  StatChart: {
    component: StatChartVisualization,
    settings: StatChartSettings,
  },
  Table: {
    component: TableVisualization,
    settings: TableSettings,
    inset: "flush-content",
  },
  TimeSeriesChart: {
    component: TimeSeriesChartVisualization,
    settings: TimeSeriesChartSettings,
  },
};

export function getVisualizationInset(
  kind: string,
): "default" | "flush-content" {
  return registry[kind]?.inset ?? "default";
}

export function getVisualizationSettings(
  kind: string,
): ComponentType<VisualizationSettingsProps> | undefined {
  return registry[kind]?.settings;
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
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">{plugin.kind}</p>
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
