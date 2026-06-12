import type * as z from "zod";
import { barChartSpec } from "@/components/dashboards/visualizations/bar-chart/spec";
import { gaugeChartSpec } from "@/components/dashboards/visualizations/gauge-chart/spec";
import { geoMapSpec } from "@/components/dashboards/visualizations/geo-map/spec";
import { statChartSpec } from "@/components/dashboards/visualizations/stat-chart/spec";
import { stateTimelineSpec } from "@/components/dashboards/visualizations/state-timeline/spec";
import { tableSpec } from "@/components/dashboards/visualizations/table/spec";
import { timeSeriesChartSpec } from "@/components/dashboards/visualizations/time-series-chart/spec";
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
  StatChart: statChartSpec,
  StateTimeline: stateTimelineSpec,
  Table: tableSpec,
  TimeSeriesChart: timeSeriesChartSpec,
  Treemap: treemapSpec,
};

/**
 * Spec schema per known QUERY plugin kind, validated at apply time. Unlisted
 * kinds (e.g. ClickHouseSQL) stay loose — never stricter than Perses.
 */
export const queryPluginSpecs: Record<string, z.ZodType> = {
  TestData: testDataSpec,
};
