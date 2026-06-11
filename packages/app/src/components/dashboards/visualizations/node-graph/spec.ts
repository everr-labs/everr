import * as z from "zod";

/**
 * NodeGraph plugin options. Loose so unknown keys flow through verbatim
 * (validation must never be stricter than Perses on shape); every known field
 * is defaulted/optional so `{}` always parses — the lenient render path
 * relies on it.
 */
export const nodeGraphSpec = z.looseObject({
  /** Edge source column; falls back to the first column when absent. */
  sourceColumn: z.string().default("source"),
  /** Edge target column; falls back to the second column when absent. */
  targetColumn: z.string().default("target"),
  /**
   * Edge weight column — drives edge thickness and node size. Falls back to
   * the first remaining numeric column; without one every edge weighs 1.
   */
  valueColumn: z.string().default("value"),
  /** Value formatting in tooltips and edge labels. */
  unit: z.string().default(""),
  /** Draw arrowheads pointing at each edge's target. */
  directed: z.boolean().default(true),
  /** Render the edge's value at its midpoint. */
  showValues: z.boolean().default(false),
  /**
   * Cap the node count: the maxNodes highest-value nodes stay, the rest (and
   * their edges) are hidden behind an "n nodes not shown" badge. Unset keeps
   * every node, up to the built-in layout limit.
   */
  maxNodes: z.number().int().min(2).optional(),
});

export type NodeGraphSpec = z.infer<typeof nodeGraphSpec>;
