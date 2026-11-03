import { readableForeground } from "@everr/ui/lib/contrast";
import { SERIES_COLORS } from "../data-utils";
import { resolveThresholdColor } from "./stat-calculations";
import type { ThresholdsSpec } from "./spec";
import type { StatTile } from "./stat-series";

const FILLED_TILE_SPARKLINE_COLOR = "rgba(255, 255, 255, 0.9)";
const STAT_BACKGROUND_GRADIENT =
  "radial-gradient(ellipse at 50% 25%, rgba(255, 255, 255, 0.10), rgba(0, 0, 0, 0.08))";
const STAT_BACKGROUND_TINTS = [
  { color: "#fff", opacity: 0.1 },
  { color: "#000", opacity: 0.08 },
] as const;

export function resolveStatBackgroundAppearance(background: string): {
  foreground: string;
  gradient: string | undefined;
} {
  const result = readableForeground(background, STAT_BACKGROUND_TINTS);
  if (!result) return { foreground: "#fff", gradient: STAT_BACKGROUND_GRADIENT };
  // color2k rounds mixed channels, so leave a small margin above 4.5:1.
  if (result.contrast >= 4.55) {
    return { foreground: result.color, gradient: STAT_BACKGROUND_GRADIENT };
  }
  // If the gradient crosses the light/dark cutoff, a solid background keeps
  // one foreground readable across the whole tile.
  return { foreground: readableForeground(background)?.color ?? result.color, gradient: undefined };
}

export function resolveStatTileColor(tile: StatTile, thresholds: ThresholdsSpec | undefined) {
  if (tile.value === undefined) return undefined;
  const seriesMax = tile.points.length > 0 ? Math.max(...tile.points.map((p) => p.value)) : 0;
  return resolveThresholdColor(tile.value, thresholds, seriesMax);
}

export function resolveStatSparklineColor(
  label: string,
  colors: Record<string, string>,
  thresholdColor: string | undefined,
  background: boolean,
  foreground?: string,
): string {
  if (background) return foreground ?? FILLED_TILE_SPARKLINE_COLOR;
  return thresholdColor ?? colors[label] ?? SERIES_COLORS[0] ?? "currentColor";
}
