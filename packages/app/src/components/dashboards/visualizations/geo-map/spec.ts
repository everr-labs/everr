import * as z from "zod";
import { COLOR_SCHEMES, SCALE_TYPES } from "../color-scale";

/**
 * GeoMap plugin options. Loose so unknown keys flow through verbatim; every
 * field defaulted/optional so `{}` parses (the lenient render path needs it).
 */
export const geoMapSpec = z.looseObject({
  mode: z.enum(["points", "choropleth"]).default("points"),

  // points mode: coordinate columns
  latColumn: z.string().default("lat"),
  lonColumn: z.string().default("lon"),

  // choropleth mode: ISO-3166 alpha-2/alpha-3 region column
  regionColumn: z.string().default("region"),
  /** How rows mapping to the same region combine (choropleth mode). */
  aggregation: z.enum(["sum", "avg", "min", "max", "last"]).default("sum"),

  // points mode: marker radius range in viewBox units
  minRadius: z.number().positive().default(3),
  maxRadius: z.number().positive().default(22),

  // shared
  /** Sizes markers / shades regions. */
  valueColumn: z.string().default("value"),
  /** Tooltip title; falls back to region/coords when omitted. */
  labelColumn: z.string().optional(),
  /** Value formatting in tooltip + legend. */
  unit: z.string().default(""),
  showLegend: z.boolean().default(true),
  colorScheme: z.enum(COLOR_SCHEMES).default("blue"),
  /** Map projection. */
  projection: z.enum(["naturalEarth1", "mercator", "equalEarth"]).default("naturalEarth1"),
  /**
   * Value→color/size curve. `sqrt` keeps marker *area* proportional to the
   * value; `log` spreads heavily skewed data (one dominant country) so the
   * rest stays visible.
   */
  scaleType: z.enum(SCALE_TYPES).default("linear"),
  /** Color/size domain; auto-derived from the data when unset. */
  min: z.number().optional(),
  max: z.number().optional(),
});

export type GeoMapSpec = z.infer<typeof geoMapSpec>;
export type GeoColorScheme = GeoMapSpec["colorScheme"];
export type GeoProjection = GeoMapSpec["projection"];
