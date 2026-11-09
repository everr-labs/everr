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

/** Where `client` falls across a plot span, clamped to 0..1. */
export function ratioWithin(client: number, start: number, length: number): number {
  return Math.max(0, Math.min(1, (client - start) / length));
}
