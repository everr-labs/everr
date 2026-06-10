import type * as z from "zod";
import { statChartSpec } from "@/components/dashboards/visualizations/stat-chart/spec";
import { tableSpec } from "@/components/dashboards/visualizations/table/spec";
import { timeSeriesChartSpec } from "@/components/dashboards/visualizations/time-series-chart/spec";

/**
 * Spec schema per known panel plugin kind. The spec modules are pure zod
 * (no React imports) so this stays safe to load from server code.
 *
 * Kinds not listed here are accepted as-is: the dashboard renders an
 * "Unknown visualization" placeholder for them instead of failing validation.
 */
export const panelPluginSpecs: Record<string, z.ZodType> = {
  StatChart: statChartSpec,
  Table: tableSpec,
  TimeSeriesChart: timeSeriesChartSpec,
};
