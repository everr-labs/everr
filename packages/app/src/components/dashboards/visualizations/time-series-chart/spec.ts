import * as z from "zod";

/**
 * TimeSeriesChart plugin options. Loose so unknown keys flow through verbatim
 * (validation must never be stricter than Perses on shape); every known field
 * is defaulted so `{}` always parses — the lenient render path relies on it.
 */
export const timeSeriesChartSpec = z.looseObject({
  unit: z.string().default(""),
  showLegend: z.boolean().default(false),
  lineWidth: z.number().positive().default(1.5),
  curveType: z
    .enum(["monotone", "linear", "natural", "stepBefore", "stepAfter"])
    .default("monotone"),
  connectNulls: z.boolean().default(false),
});

export type TimeSeriesChartSpec = z.infer<typeof timeSeriesChartSpec>;
