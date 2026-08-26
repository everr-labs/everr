import type * as z from "zod";
import { barChartSpec } from "@/components/dashboards/visualizations/bar-chart/spec";
import type { SpecDeprecation } from "@/components/dashboards/visualizations/deprecations";
import { gaugeChartSpec } from "@/components/dashboards/visualizations/gauge-chart/spec";
import { geoMapSpec } from "@/components/dashboards/visualizations/geo-map/spec";
import { heatmapSpec } from "@/components/dashboards/visualizations/heatmap/spec";
import { nodeGraphSpec } from "@/components/dashboards/visualizations/node-graph/spec";
import { statChartSpec } from "@/components/dashboards/visualizations/stat-chart/spec";
import { stateTimelineSpec } from "@/components/dashboards/visualizations/state-timeline/spec";
import { statusHistorySpec } from "@/components/dashboards/visualizations/status-history/spec";
import { tableSpec } from "@/components/dashboards/visualizations/table/spec";
import {
  timeSeriesChartDeprecations,
  timeSeriesChartSpec,
} from "@/components/dashboards/visualizations/time-series-chart/spec";
import { treemapSpec } from "@/components/dashboards/visualizations/treemap/spec";
import { testDataSpec } from "./testdata/spec";

/**
 * Spec schema per known panel plugin kind. The spec modules are pure zod
 * (no React imports) so this stays safe to load from server code.
 *
 * Kinds not listed here are accepted as-is: the dashboard renders an
 * "Unknown visualization" placeholder for them instead of failing validation.
 */
export const panelPluginSpecs: Record<string, z.ZodType> = {
  BarChart: barChartSpec,
  GaugeChart: gaugeChartSpec,
  GeoMap: geoMapSpec,
  Heatmap: heatmapSpec,
  NodeGraph: nodeGraphSpec,
  StatChart: statChartSpec,
  StateTimeline: stateTimelineSpec,
  StatusHistory: statusHistorySpec,
  Table: tableSpec,
  TimeSeriesChart: timeSeriesChartSpec,
  Treemap: treemapSpec,
};

/**
 * Options per panel plugin kind that still parse but no longer do what they
 * say. Read from the raw spec, not the parsed one, so the original value is
 * available to name in the message.
 *
 * A kind with nothing deprecated is simply absent. Keeping this beside the
 * schemas is deliberate: both the render path and the apply path need it, and
 * both already load this module.
 */
export const panelPluginDeprecations: Record<
  string,
  (raw: unknown) => SpecDeprecation[]
> = {
  TimeSeriesChart: timeSeriesChartDeprecations,
};

/**
 * Spec schema per known QUERY plugin kind, validated at apply time. Unlisted
 * kinds (e.g. ClickHouseSQL) stay loose — never stricter than Perses.
 */
export const queryPluginSpecs: Record<string, z.ZodType> = {
  TestData: testDataSpec,
};
