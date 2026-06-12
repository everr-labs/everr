/**
 * Multi-stop sequential color ramps for heatmap cells. Unlike the GeoMap's
 * transparency ramp (which must reveal the land beneath), heatmap cells are
 * opaque — low values get a real low-end color, so density reads from hue and
 * lightness rather than alpha.
 */

export const HEATMAP_COLOR_SCHEMES = [
  "spectral",
  "greenYellowRed",
  "blues",
  "greens",
  "oranges",
  "reds",
] as const;
export type HeatmapColorScheme = (typeof HEATMAP_COLOR_SCHEMES)[number];

type Rgb = [number, number, number];

/** Evenly spaced gradient stops per scheme, low → high. */
const SCHEME_STOPS: Record<HeatmapColorScheme, Rgb[]> = {
  // ColorBrewer RdYlBu reversed: cool blue → pale yellow → hot red
  spectral: [
    [69, 117, 180],
    [171, 217, 233],
    [254, 224, 144],
    [252, 141, 89],
    [215, 48, 39],
  ],
  // ColorBrewer RdYlGn reversed: healthy green → amber → alarming red
  greenYellowRed: [
    [26, 152, 80],
    [166, 217, 106],
    [254, 224, 139],
    [244, 109, 67],
    [165, 0, 38],
  ],
  // single-hue ramps: light tint → saturated → dark shade
  blues: [
    [219, 234, 254],
    [59, 130, 246],
    [30, 58, 138],
  ],
  greens: [
    [220, 252, 231],
    [34, 197, 94],
    [20, 83, 45],
  ],
  oranges: [
    [255, 237, 213],
    [249, 115, 22],
    [124, 45, 18],
  ],
  reds: [
    [254, 226, 226],
    [239, 68, 68],
    [127, 29, 29],
  ],
};

/** RGB at position t in [0,1], linearly interpolated between the stops. */
export function heatmapColorRgb(scheme: HeatmapColorScheme, t: number): Rgb {
  const stops = SCHEME_STOPS[scheme];
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const pos = u * (stops.length - 1);
  const i = Math.min(Math.floor(pos), stops.length - 2);
  const f = pos - i;
  const [r0, g0, b0] = stops[i]!;
  const [r1, g1, b1] = stops[i + 1]!;
  return [
    Math.round(r0 + (r1 - r0) * f),
    Math.round(g0 + (g1 - g0) * f),
    Math.round(b0 + (b1 - b0) * f),
  ];
}

/** CSS color at position t in [0,1]. */
export function heatmapColor(scheme: HeatmapColorScheme, t: number): string {
  const [r, g, b] = heatmapColorRgb(scheme, t);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Whether white text is readable on the color (perceived luminance). */
export function isDarkColor([r, g, b]: Rgb): boolean {
  return 0.299 * r + 0.587 * g + 0.114 * b < 150;
}
