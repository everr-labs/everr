import { type ComponentType, lazy, Suspense, useMemo } from "react";
import type * as z from "zod";
import type { PanelPlugin } from "@/data/dashboards/schema";
import { GaugeChartVisualization } from "./gauge-chart/gauge-chart-visualization";
import { gaugeChartSpec } from "./gauge-chart/spec";
import type { GeoMapSpec } from "./geo-map/spec";
import { geoMapSpec } from "./geo-map/spec";
import { parseSpecLenient } from "./parse-spec";
import { statChartSpec } from "./stat-chart/spec";
import { StatChartVisualization } from "./stat-chart/stat-chart-visualization";
import { tableSpec } from "./table/spec";
import { TableVisualization } from "./table/table-visualization";
import { timeSeriesChartSpec } from "./time-series-chart/spec";
import { TimeSeriesChartVisualization } from "./time-series-chart/time-series-chart-visualization";
import { treemapSpec } from "./treemap/spec";
import { TreemapVisualization } from "./treemap/treemap-visualization";

const GeoMapVisualization = lazy(() =>
  import("./geo-map/geo-map-visualization").then((m) => ({
    default: m.GeoMapVisualization as ComponentType<
      VisualizationProps<GeoMapSpec>
    >,
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
  inset?: "default" | "flush-content";
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
}): VisualizationEntry {
  return entry as VisualizationEntry;
}

const registry: Record<string, VisualizationEntry> = {
  GaugeChart: defineVisualization({
    schema: gaugeChartSpec,
    component: GaugeChartVisualization,
  }),
  GeoMap: defineVisualization({
    schema: geoMapSpec,
    component: GeoMapVisualization,
    inset: "flush-content",
  }),
  StatChart: defineVisualization({
    schema: statChartSpec,
    component: StatChartVisualization,
  }),
  Table: defineVisualization({
    schema: tableSpec,
    component: TableVisualization,
    inset: "flush-content",
  }),
  TimeSeriesChart: defineVisualization({
    schema: timeSeriesChartSpec,
    component: TimeSeriesChartVisualization,
  }),
  Treemap: defineVisualization({
    schema: treemapSpec,
    component: TreemapVisualization,
    inset: "flush-content",
  }),
};

export function getVisualizationInset(
  kind: string,
): "default" | "flush-content" {
  return registry[kind]?.inset ?? "default";
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
          Unknown visualization:{" "}
          <code className="font-mono">{plugin.kind}</code>
        </p>
      </div>
    );
  }

  const Component = entry.component;
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center p-4 text-center text-muted-foreground">
          <p className="text-sm">Loading…</p>
        </div>
      }
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
