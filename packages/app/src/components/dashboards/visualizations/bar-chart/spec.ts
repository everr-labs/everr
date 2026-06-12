import * as z from "zod";

/**
 * BarChart plugin options. Loose so unknown keys flow through verbatim
 * (validation must never be stricter than Perses on shape); every known field
 * is defaulted so `{}` always parses — the lenient render path relies on it.
 */
export const barChartSpec = z.looseObject({
  unit: z.string().default(""),
  showLegend: z.boolean().default(false),
  /** `stacked` piles series into one bar per x value; `percent` additionally
   * normalizes each stack to 100% (the value axis becomes percentages). */
  stacking: z.enum(["none", "stacked", "percent"]).default("none"),
  /** `horizontal` draws bars left-to-right with categories on the y-axis. */
  orientation: z.enum(["vertical", "horizontal"]).default("vertical"),
  showValues: z.boolean().default(false),
});

export type BarChartSpec = z.infer<typeof barChartSpec>;
