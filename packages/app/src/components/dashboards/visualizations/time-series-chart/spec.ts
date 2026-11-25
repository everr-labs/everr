import * as z from "zod";
import { hexColorSpec } from "../hex-color-spec";
import { valueFormatSpec } from "../value-format-spec";

/**
 * TimeSeriesChart plugin options. Loose so unknown keys flow through verbatim
 * (validation must never be stricter than Perses on shape); every known field
 * is defaulted so `{}` always parses — the lenient render path relies on it.
 */
export const timeSeriesChartSpec = z.looseObject({
  valueFormat: valueFormatSpec.optional(),
  showLegend: z.boolean().default(false),
  lineWidth: z.number().positive().default(1),
  curveType: z
    .enum(["monotone", "linear", "natural", "stepBefore", "stepAfter"])
    .default("monotone"),
  connectNulls: z.boolean().default(false),
  stacked: z.boolean().default(false),
  yAxis: z
    .looseObject({
      min: z.union([z.number().finite(), z.literal("auto")]).optional(),
      max: z.union([z.number().finite(), z.literal("auto")]).optional(),
    })
    .refine(({ min, max }) => typeof min !== "number" || typeof max !== "number" || min < max, {
      path: ["max"],
      message: "must be greater than min",
    })
    .optional(),
  /** Fixed series name → hex color mapping; unmapped series cycle the shared
   * palette. Use it to keep a series the same color across panels. */
  colors: z.record(z.string(), hexColorSpec).default({}),
});

export type TimeSeriesChartSpec = z.infer<typeof timeSeriesChartSpec>;
