import * as z from "zod";
import { calculationSpec, thresholdsSpec } from "../stat-chart/spec";

/**
 * GaugeChart plugin options. Loose so unknown keys flow through verbatim
 * (validation must never be stricter than Perses on shape); every known field
 * is defaulted so `{}` always parses — the lenient render path relies on it.
 */
export const gaugeChartSpec = z.looseObject({
  calculation: calculationSpec.default("last"),
  unit: z.string().default(""),
  /** Fixed fraction digits; omitted = up to 2, trailing zeros dropped. */
  decimals: z.number().int().min(0).max(10).optional(),
  /** Gauge axis lower bound. */
  min: z.number().default(0),
  /**
   * Gauge axis upper bound. The arc fills (value - min) / (max - min); values
   * outside the bounds clamp to an empty/full arc while the text shows the
   * real value. Also the `percent` thresholds reference when `thresholds.max`
   * is omitted.
   */
  max: z.number().default(100),
  thresholds: thresholdsSpec.optional(),
  /** Show the series label even on a single-gauge panel (multi-gauge always shows it). */
  showLabel: z.boolean().default(false),
  /** Text shown for a query that produced no value. */
  noValue: z.string().default("–"),
});

export type GaugeChartSpec = z.infer<typeof gaugeChartSpec>;
