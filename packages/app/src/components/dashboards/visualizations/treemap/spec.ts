import * as z from "zod";

/**
 * Treemap plugin options. Loose so unknown keys flow through verbatim; every
 * field defaulted/optional so `{}` parses (the lenient render path needs it).
 */
export const treemapSpec = z.looseObject({
  /** Tile label column. */
  nameColumn: z.string().default("name"),
  /** Tile size column — rows with a non-positive value have no area and are dropped. */
  valueColumn: z.string().default("value"),
  /**
   * Optional grouping column: tiles sharing a group value share a color and
   * the legend lists the groups. Without it, multi-query results group by
   * query instead.
   */
  groupColumn: z.string().optional(),
  /**
   * Cap the tile count: the largest maxTiles - 1 tiles stay, the rest merge
   * into a single muted "Other (n)" tile. Unset renders every row as a tile.
   */
  maxTiles: z.number().int().min(2).optional(),
  /** Value formatting in tiles + tooltip. */
  unit: z.string().default(""),
  /** Render the value inside tiles that are large enough. */
  showValues: z.boolean().default(true),
  /** Group color legend — only shown when there are groups. */
  showLegend: z.boolean().default(true),
});

export type TreemapSpec = z.infer<typeof treemapSpec>;
