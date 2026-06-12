import * as z from "zod";
import { SCALE_TYPES } from "../color-scale";
import { HEATMAP_COLOR_SCHEMES } from "./heatmap-colors";

/**
 * Heatmap plugin options. Loose so unknown keys flow through verbatim
 * (validation must never be stricter than Perses on shape); every known field
 * is defaulted or optional so `{}` always parses — the lenient render path
 * relies on it.
 */
export const heatmapSpec = z.looseObject({
  /** Y-bucket column; defaults to the first non-time column. */
  yColumn: z.string().optional(),
  /**
   * Cell intensity column; defaults to the first numeric column that is
   * neither the time column nor `yColumn`.
   */
  valueColumn: z.string().optional(),
  /** Value formatting in cells, tooltip and legend. */
  unit: z.string().default(""),
  /** Color ramp legend (min → max) below the grid. */
  showLegend: z.boolean().default(true),
  /** Render the value inside cells wide enough to fit it. */
  showValues: z.boolean().default(false),
  /** Cell color ramp — multi-hue (`spectral`, `greenYellowRed`) or single-hue light→dark. */
  colorScheme: z.enum(HEATMAP_COLOR_SCHEMES).default("spectral"),
  /**
   * Value→color curve. `sqrt` lifts the low end; `log` spreads heavily
   * skewed data (e.g. latency histogram counts) so sparse cells stay visible.
   */
  scaleType: z.enum(SCALE_TYPES).default("linear"),
  /** Color domain; derived from the data when unset (min floors at 0). */
  min: z.number().optional(),
  max: z.number().optional(),
  /** Gap between cells in px. */
  cellGap: z.number().min(0).max(4).default(1),
});

export type HeatmapSpec = z.infer<typeof heatmapSpec>;
