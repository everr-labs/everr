/**
 * Shared sequential color scale for value-intensity visualizations (GeoMap
 * markers/choropleth, Heatmap cells): named color schemes, a transparent→full
 * ramp, and the value→[0,1] normalization curves.
 */

export const COLOR_SCHEMES = ["blue", "green", "orange", "red"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

export const SCALE_TYPES = ["linear", "sqrt", "log"] as const;
export type ScaleType = (typeof SCALE_TYPES)[number];

/** Full saturated color per scheme (the ramp's high end). */
const SCHEME_COLOR: Record<ColorScheme, [number, number, number]> = {
  blue: [37, 99, 235],
  green: [22, 163, 74],
  orange: [234, 88, 12],
  red: [220, 38, 38],
};

/**
 * Fill for a scheme at position t in [0,1]: the scheme's full color at
 * opacity t, so low values fade toward transparent (revealing the surface
 * beneath) and high values reach full color. Avoids a washed-out white low
 * end on dark backgrounds.
 */
export function colorRamp(scheme: ColorScheme, t: number): string {
  const [r, g, b] = SCHEME_COLOR[scheme];
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const a = Math.round(u * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** The scheme's full color — used as a solid base color (markers, swatches). */
export function schemeBaseColor(scheme: ColorScheme): string {
  const [r, g, b] = SCHEME_COLOR[scheme];
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Map a value over [d0,d1] onto [0,1], clamped, through the spec's scale
 * curve. `sqrt` keeps marker area proportional to the value; `log` works on
 * the raw values (not the normalized t) so decades spread evenly — when the
 * domain min is ≤ 0 it spans the top three decades below the max.
 */
export function normalizeValue(
  value: number,
  [d0, d1]: [number, number],
  scale: ScaleType = "linear",
): number {
  if (scale === "log") {
    if (d1 <= 0) return value >= d1 ? 1 : 0;
    const lo = d0 > 0 ? d0 : d1 / 1000;
    if (d1 <= lo) return value >= d1 ? 1 : 0;
    const v = value > 0 ? value : lo;
    const t = (Math.log(v) - Math.log(lo)) / (Math.log(d1) - Math.log(lo));
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }
  if (d1 <= d0) return 1;
  const t = (value - d0) / (d1 - d0);
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return scale === "sqrt" ? Math.sqrt(u) : u;
}
