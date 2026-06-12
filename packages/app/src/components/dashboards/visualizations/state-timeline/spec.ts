import * as z from "zod";

/**
 * StateTimeline plugin options. Loose so unknown keys flow through verbatim
 * (validation must never be stricter than Perses on shape); every known field
 * is defaulted so `{}` always parses — the lenient render path relies on it.
 */
export const stateTimelineSpec = z.looseObject({
  /**
   * Long-format input: one lane per distinct value of this column, with the
   * state read from `stateColumn`. Unset, the result is wide — every non-time
   * column is its own lane.
   */
  seriesColumn: z.string().optional(),
  /**
   * State column for long-format input; defaults to the first column that is
   * neither the time column nor `seriesColumn`. Ignored without `seriesColumn`.
   */
  stateColumn: z.string().optional(),
  /** Merge consecutive samples with the same state into one segment. */
  mergeConsecutive: z.boolean().default(true),
  /** Render the state text inside segments wide enough to fit it. */
  showValues: z.boolean().default(true),
  /** State color legend. */
  showLegend: z.boolean().default(true),
  /** Fixed state → CSS color mapping; unmapped states cycle the shared palette. */
  colors: z.record(z.string(), z.string()).default({}),
  /** Segment thickness as a fraction of the lane height. */
  rowHeight: z.number().min(0.2).max(1).default(0.9),
});

export type StateTimelineSpec = z.infer<typeof stateTimelineSpec>;
