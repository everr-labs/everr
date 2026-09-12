import { SERIES_COLORS } from "../data-utils";

const FILLED_TILE_SPARKLINE_COLOR = "rgba(255, 255, 255, 0.9)";

export function resolveStatSparklineColor(
  label: string,
  colors: Record<string, string>,
  thresholdColor: string | undefined,
  background: boolean,
): string {
  if (background) return FILLED_TILE_SPARKLINE_COLOR;
  return thresholdColor ?? colors[label] ?? SERIES_COLORS[0] ?? "currentColor";
}
