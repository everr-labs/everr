import * as z from "zod";

/**
 * StatusHistory plugin options. Loose so unknown keys flow through verbatim
 * (validation must never be stricter than Perses on shape); every known field
 * is defaulted so `{}` always parses — the lenient render path relies on it.
 */
export const statusHistorySpec = z.looseObject({
  /**
   * Long-format input: one lane per distinct value of this column, with the
   * status read from `stateColumn`. Unset, the result is wide — every non-time
   * column is its own lane.
   */
  seriesColumn: z.string().optional(),
  /**
   * Status column for long-format input; defaults to the first column that is
   * neither the time column nor `seriesColumn`. Ignored without `seriesColumn`.
   */
  stateColumn: z.string().optional(),
  /** Render the status text inside cells wide enough to fit it. */
  showValues: z.boolean().default(false),
  /** Status color legend. */
  showLegend: z.boolean().default(true),
  /** Fixed status → CSS color mapping; unmapped statuses cycle the shared palette. */
  colors: z.record(z.string(), z.string()).default({}),
  /** Cell height as a fraction of the lane height. */
  rowHeight: z.number().min(0.2).max(1).default(0.9),
  /** Cell width as a fraction of the sampling-interval slot. */
  colWidth: z.number().min(0.2).max(1).default(0.9),
});

export type StatusHistorySpec = z.infer<typeof statusHistorySpec>;
