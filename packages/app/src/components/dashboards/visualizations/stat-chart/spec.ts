import * as z from "zod";

const thresholdStep = z.looseObject({
  value: z.number(),
  color: z.string().optional(),
});

const thresholdsSpec = z.looseObject({
  mode: z.enum(["absolute", "percent"]).optional(),
  defaultColor: z.string().optional(),
  steps: z.array(thresholdStep).optional(),
});

/**
 * StatChart plugin options. Loose so unknown keys flow through verbatim
 * (validation must never be stricter than Perses on shape); every known field
 * is defaulted so `{}` always parses — the lenient render path relies on it.
 */
export const statChartSpec = z.looseObject({
  calculation: z
    .enum(["last", "first", "mean", "min", "max", "sum"])
    .default("last"),
  unit: z.string().default(""),
  sparkline: z.boolean().default(false),
  thresholds: thresholdsSpec.optional(),
});

export type StatChartSpec = z.infer<typeof statChartSpec>;
export type CalculationType = StatChartSpec["calculation"];
export type ThresholdsSpec = z.infer<typeof thresholdsSpec>;
