import * as z from "zod";
import type { SpecDeprecation } from "../deprecations";

/**
 * Line interpolations. `monotone` and `natural` are the smoothed ones: they
 * are still accepted so stored panels keep loading, but they draw as `linear`
 * and report a deprecation. Smoothing invents values between samples, which
 * on a time series reads as data that was never measured — a curve arcing
 * across a gap looks like a slow decline rather than an outage.
 */
const CURVE_TYPES = [
  "linear",
  "stepBefore",
  "stepAfter",
  "monotone",
  "natural",
] as const;

const DEPRECATED_CURVE_TYPES = new Set<string>(["monotone", "natural"]);

/**
 * TimeSeriesChart plugin options. Loose so unknown keys flow through verbatim
 * (validation must never be stricter than Perses on shape); every known field
 * is defaulted so `{}` always parses — the lenient render path relies on it.
 */
export const timeSeriesChartSpec = z.looseObject({
  unit: z.string().default(""),
  showLegend: z.boolean().default(false),
  lineWidth: z.number().positive().default(1.5),
  curveType: z.enum(CURVE_TYPES).default("linear"),
  connectNulls: z.boolean().default(false),
  stacked: z.boolean().default(false),
});

export type TimeSeriesChartSpec = z.infer<typeof timeSeriesChartSpec>;

export function timeSeriesChartDeprecations(raw: unknown): SpecDeprecation[] {
  const curveType = (raw as { curveType?: unknown } | null | undefined)
    ?.curveType;
  if (typeof curveType !== "string" || !DEPRECATED_CURVE_TYPES.has(curveType)) {
    return [];
  }
  return [
    {
      option: "curveType",
      message: `"${curveType}" smoothing is no longer drawn; this panel renders as "linear"`,
      fix: `replace \`curveType: ${curveType}\` with \`curveType: linear\`, or drop the line (linear is the default)`,
    },
  ];
}
