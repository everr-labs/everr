import * as z from "zod";
import { calculationSpec, thresholdsSpec } from "../stat-chart/spec";

/**
 * The options of the GaugeChart plugin. The object is loose, because unknown
 * keys must stay in the output. The validation must not be more strict than
 * Perses. All known fields have a default value, because `{}` must always
 * parse. The lenient render path needs this.
 */
export const gaugeChartSpec = z.looseObject({
  calculation: calculationSpec.default("last"),
  unit: z.string().default(""),
  /**
   * The number of fraction digits. If you do not set it, the value shows a
   * maximum of 2 digits, and the zeros at the end are removed.
   */
  decimals: z.number().int().min(0).max(10).optional(),
  /** The lower bound of the gauge axis. */
  min: z.number().default(0),
  /**
   * The upper bound of the gauge axis. The arc fills to
   * (value - min) / (max - min). If a value is outside the bounds, the arc
   * becomes empty or full, but the text shows the true value. The `percent`
   * thresholds also use this bound if you do not set `thresholds.max`.
   */
  max: z.number().default(100),
  thresholds: thresholdsSpec.optional(),
  /** The shape: the default semicircle, or a flat horizontal bar. */
  variant: z.enum(["arc", "horizontal"]).default("arc"),
  /** Shows the min and max labels at the ends of the gauge. */
  showAxis: z.boolean().default(true),
  /** Shows a number at the tick mark of each threshold step. */
  showThresholdLabels: z.boolean().default(false),
  /**
   * Shows the series label on a panel that has one gauge. A panel that has
   * more than one gauge always shows the labels.
   */
  showLabel: z.boolean().default(false),
  /** The text to show if a query gives no value. */
  noValue: z.string().default("–"),
});

export type GaugeChartSpec = z.infer<typeof gaugeChartSpec>;
