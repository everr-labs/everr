export interface GridInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The plotting area in client coordinates: the chart element's box minus the
 * grid insets we gave ECharts. Null while the box is too small to plot in.
 */
export function getPlotRect(element: HTMLElement, grid: GridInsets): PlotRect | null {
  const bounds = element.getBoundingClientRect();
  const width = bounds.width - grid.left - grid.right;
  const height = bounds.height - grid.top - grid.bottom;
  if (!(width > 0 && height > 0)) return null;
  return { left: bounds.left + grid.left, top: bounds.top + grid.top, width, height };
}

/**
 * The plotting area in the chart element's own coordinates, from the size
 * ECharts keeps. Unlike `getPlotRect` it reads no layout, so it is safe to call
 * while rendering on every pointer move.
 */
export function plotWithin(
  chart: { getWidth(): number; getHeight(): number },
  grid: GridInsets,
): PlotRect {
  return {
    left: grid.left,
    top: grid.top,
    width: chart.getWidth() - grid.left - grid.right,
    height: chart.getHeight() - grid.top - grid.bottom,
  };
}

/** Where `client` falls across a plot span, clamped to 0..1. */
export function ratioWithin(client: number, start: number, length: number): number {
  return Math.max(0, Math.min(1, (client - start) / length));
}
