import * as z from "zod";

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

  // shared
  /** Sizes markers / shades regions. */
  valueColumn: z.string().default("value"),
  /** Tooltip title; falls back to region/coords when omitted. */
  labelColumn: z.string().optional(),
  /** Value formatting in tooltip + legend. */
  unit: z.string().default(""),
  showLegend: z.boolean().default(true),
  colorScheme: z.enum(["blue", "green", "orange", "red"]).default("blue"),
  /** Color/size domain; auto-derived from the data when unset. */
  min: z.number().optional(),
  max: z.number().optional(),
});

export type GeoMapSpec = z.infer<typeof geoMapSpec>;
export type GeoColorScheme = GeoMapSpec["colorScheme"];
