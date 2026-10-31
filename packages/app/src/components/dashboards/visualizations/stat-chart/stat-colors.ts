import { SERIES_COLORS } from "../data-utils";
import { resolveThresholdColor } from "./stat-calculations";
import type { ThresholdsSpec } from "./spec";
import type { StatTile } from "./stat-series";

const FILLED_TILE_SPARKLINE_COLOR = "rgba(255, 255, 255, 0.9)";
export const STAT_BACKGROUND_GRADIENT =
  "radial-gradient(ellipse at 50% 25%, rgba(255, 255, 255, 0.10), rgba(0, 0, 0, 0.08))";

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
): string {
  if (background) return FILLED_TILE_SPARKLINE_COLOR;
  return thresholdColor ?? colors[label] ?? SERIES_COLORS[0] ?? "currentColor";
}
