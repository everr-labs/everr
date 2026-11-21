import { Skeleton } from "@everr/ui/components/skeleton";
import { type ComponentType, lazy, Suspense, useMemo } from "react";
import type * as z from "zod";
import type { PanelPlugin } from "#app/data/dashboards/schema.ts";
import { BarChartVisualization } from "./bar-chart/bar-chart-visualization";
import { barChartSpec } from "./bar-chart/spec";
import { GaugeChartVisualization } from "./gauge-chart/gauge-chart-visualization";
import { gaugeChartSpec } from "./gauge-chart/spec";
import { geoMapSpec } from "./geo-map/spec";
import { HeatmapVisualization } from "./heatmap/heatmap-visualization";
import { heatmapSpec } from "./heatmap/spec";
import { NodeGraphVisualization } from "./node-graph/node-graph-visualization";
import { nodeGraphSpec } from "./node-graph/spec";
import { parseSpecLenient } from "./parse-spec";
import { statChartSpec } from "./stat-chart/spec";
import { StatChartVisualization } from "./stat-chart/stat-chart-visualization";
import { stateTimelineSpec } from "./state-timeline/spec";
import { StateTimelineVisualization } from "./state-timeline/state-timeline-visualization";
import { statusHistorySpec } from "./status-history/spec";
import { StatusHistoryVisualization } from "./status-history/status-history-visualization";
import { tableSpec } from "./table/spec";
import { TableVisualization } from "./table/table-visualization";
import { timeSeriesChartSpec } from "./time-series-chart/spec";
import { TimeSeriesChartVisualization } from "./time-series-chart/time-series-chart-visualization";
import { treemapSpec } from "./treemap/spec";
import { TreemapVisualization } from "./treemap/treemap-visualization";

const GeoMapVisualization = lazy(() =>
  import("./geo-map/geo-map-visualization").then((m) => ({
    default: m.GeoMapVisualization,
  })),
);

export type QueryResultRow = Record<string, string | number | boolean | null>;

export interface ResolvedTimeRange {
  from: Date;
  to: Date;
}

export interface VisualizationProps<TSpec = unknown> {
  spec: TSpec;
  data?: QueryResultRow[][];
  timeRange: ResolvedTimeRange;
  onTimeRangeChange: (range: ResolvedTimeRange) => void;
}

interface VisualizationEntry {
  schema: z.ZodType;
  component: ComponentType<VisualizationProps>;
  /** Charts run to the panel's edges; "default" pads the content instead. */
  inset?: "default" | "flush-content";
  /** Drawn over the dashboard's time range, so its queries start on the step's grid. */
  overTime?: boolean;
}

/**
 * Ties a visualization's component to its spec schema: the component receives
 * the schema's parsed output, never the raw plugin spec. The registry erases
 * the spec type; this definition site is where the pairing is checked.
 */
function defineVisualization<S extends z.ZodType>(entry: {
  schema: S;
  component: ComponentType<VisualizationProps<z.output<S>>>;
  inset?: "default" | "flush-content";
  overTime?: boolean;
}): VisualizationEntry {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- intentional spec-type erasure: the registry holds heterogeneous visualizations under one entry type, and React props are contravariant so a specific-spec component isn't assignable to the erased VisualizationProps<unknown> component
  return entry as VisualizationEntry;
}

const registry: Record<string, VisualizationEntry> = {
  BarChart: defineVisualization({
    schema: barChartSpec,
    component: BarChartVisualization,
  }),
  GaugeChart: defineVisualization({
    schema: gaugeChartSpec,
    component: GaugeChartVisualization,
    inset: "default",
  }),
  GeoMap: defineVisualization({
    schema: geoMapSpec,
    component: GeoMapVisualization,
  }),
  Heatmap: defineVisualization({
    schema: heatmapSpec,
    component: HeatmapVisualization,
    overTime: true,
  }),
  NodeGraph: defineVisualization({
    schema: nodeGraphSpec,
    component: NodeGraphVisualization,
  }),
  StatChart: defineVisualization({
    schema: statChartSpec,
    component: StatChartVisualization,
  }),
  StateTimeline: defineVisualization({
    schema: stateTimelineSpec,
    component: StateTimelineVisualization,
    overTime: true,
  }),
  StatusHistory: defineVisualization({
    schema: statusHistorySpec,
    component: StatusHistoryVisualization,
    overTime: true,
  }),
  Table: defineVisualization({
    schema: tableSpec,
    component: TableVisualization,
  }),
  TimeSeriesChart: defineVisualization({
    schema: timeSeriesChartSpec,
    component: TimeSeriesChartVisualization,
    overTime: true,
  }),
  Treemap: defineVisualization({
    schema: treemapSpec,
    component: TreemapVisualization,
  }),
};

/**
 * Whether a panel is drawn over the time range: its queries then start on the
 * step's grid. Stats, tables and other totals keep the exact range, and a
 * stat's sparkline fills its width whatever the range.
 */
export function drawsOverTime(kind: string): boolean {
  return registry[kind]?.overTime ?? false;
}

export function getVisualizationInset(kind: string): "default" | "flush-content" {
  const entry = registry[kind];
  // An unknown kind renders a padded notice, not a chart.
  return entry ? (entry.inset ?? "flush-content") : "default";
}

/**
 * Warnings for plugin spec options that fail the visualization's schema and
 * will be ignored at render time (defaults apply instead). Empty for valid
 * specs and unknown kinds.
 */
export function getVisualizationSpecWarnings(plugin: PanelPlugin): string[] {
  const entry = registry[plugin.kind];
  if (!entry) return [];
  return parseSpecLenient(entry.schema, plugin.spec).warnings;
}

export interface PanelVisualizationProps {
  plugin: PanelPlugin;
  data?: QueryResultRow[][];
  timeRange: ResolvedTimeRange;
  onTimeRangeChange: (range: ResolvedTimeRange) => void;
}

export function PanelVisualization({
  plugin,
  data,
  timeRange,
  onTimeRangeChange,
}: PanelVisualizationProps) {
  const entry = registry[plugin.kind];

  const parsed = useMemo(
    () => (entry ? parseSpecLenient(entry.schema, plugin.spec) : null),
    [entry, plugin.spec],
  );

  if (!entry || !parsed) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-muted-foreground">
        <p className="text-sm">
          Unknown visualization: <code className="font-mono">{plugin.kind}</code>
        </p>
      </div>
    );
  }

  const Component = entry.component;
  return (
    <Suspense
      // The panel's own pending look, so a lazily loaded visualization (the
      // map) reads as the same load rather than a third state.
      fallback={<Skeleton className="h-full w-full" />}
    >
      <Component
        spec={parsed.spec}
        data={data}
        timeRange={timeRange}
        onTimeRangeChange={onTimeRangeChange}
      />
    </Suspense>
  );
}
