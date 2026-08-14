import * as z from "zod";

const thresholdStep = z.looseObject({
  value: z.number(),
  color: z.string().optional(),
  /** Qualitative label for the band this step starts (e.g. "Poor"). */
  name: z.string().optional(),
});

export const thresholdsSpec = z.looseObject({
  mode: z.enum(["absolute", "percent"]).default("absolute"),
  defaultColor: z.string().optional(),
  /** Qualitative label for the band below the first step (e.g. "Good"). */
  defaultName: z.string().optional(),
  steps: z.array(thresholdStep).optional(),
  /**
   * Reference value for `percent` mode: steps compare against value/max*100.
   * Falls back to the series' own max when omitted — set it (e.g. to an SLA
   * ceiling) for percentages that stay stable across time windows.
   */
  max: z.number().optional(),
});

/**
 * StatChart plugin options. Loose so unknown keys flow through verbatim
 * (validation must never be stricter than Perses on shape); every known field
 * is defaulted so `{}` always parses — the lenient render path relies on it.
 */
/** How a series is reduced to one number — shared with GaugeChart. */
export const calculationSpec = z.enum([
  "last",
  "first",
  "mean",
  "min",
  "max",
  "sum",
  "count",
  "range",
  "diff",
]);

export const statChartSpec = z.looseObject({
  calculation: calculationSpec.default("last"),
  unit: z.string().default(""),
  /** Fixed fraction digits; omitted = up to 2, trailing zeros dropped. */
  decimals: z.number().int().min(0).max(10).optional(),
  sparkline: z.boolean().default(false),
  thresholds: thresholdsSpec.optional(),
  /** "background" fills the tile with the threshold color instead of tinting the value text. */
  colorMode: z.enum(["value", "background"]).default("value"),
  /** Show the series label even on a single-tile panel (multi-tile always shows it). */
  showLabel: z.boolean().default(false),
  /** Text shown for a query that produced no value. */
  noValue: z.string().default("–"),
});

export type StatChartSpec = z.infer<typeof statChartSpec>;
export type CalculationType = StatChartSpec["calculation"];
export type ThresholdsSpec = z.infer<typeof thresholdsSpec>;
