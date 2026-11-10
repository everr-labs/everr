import * as z from "zod";
import { valueFormatSpec } from "../value-format-spec";

/**
 * NodeGraph plugin options. Loose so unknown keys flow through verbatim
 * (validation must never be stricter than Perses on shape); every known field
 * is defaulted/optional so `{}` always parses — the lenient render path
 * relies on it.
 */
export const nodeGraphSpec = z.looseObject({
  /** Value formatting in tooltips and edge labels. */
  valueFormat: valueFormatSpec.optional(),
  /** Edge source column; falls back to the first column when absent. */
  sourceColumn: z.string().default("source"),
  /** Edge target column; falls back to the second column when absent. */
  targetColumn: z.string().default("target"),
  /**
   * Edge weight column — drives edge thickness and each node's value. Falls back to
   * the first remaining numeric column; without one every edge weighs 1.
   */
  valueColumn: z.string().default("value"),
  /**
   * Per-edge figures shown on each card and in tooltips, such as an error
   * rate or a latency. A node's figures cover the calls it receives.
   */
  stats: z
    .array(
      z.looseObject({
        /** The column, also the stat's label. */
        column: z.string(),
        /**
         * How rows (and a node's incoming edges) combine: `mean` averages by
         * calls (latency, sizes); `rate` divides the summed column by calls
         * (failed calls into an error rate); `sum` adds it up (counts).
         */
        reduce: z.enum(["mean", "rate", "sum"]).default("mean"),
        format: valueFormatSpec.optional(),
        /**
         * [warning, critical], in the stat's own units. Rising, high values
         * are worse; falling (warning above critical), low ones are. Without
         * them the stat is shown but colors nothing.
         */
        thresholds: z.tuple([z.number(), z.number()]).optional(),
      }),
    )
    .default([]),
  /** Nodes are service names: clicking one opens Traces for that service. */
  linkToTraces: z.boolean().default(false),
  /** Ranks run left to right ("LR", callers on the left) or top to bottom ("TB"). */
  direction: z.enum(["LR", "TB"]).default("LR"),
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
