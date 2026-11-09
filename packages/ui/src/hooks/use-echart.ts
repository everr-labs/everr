import { GridComponent } from "echarts/components";
import type { EChartsType } from "echarts/core";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { type RefObject, useEffect, useState } from "react";

echarts.use([GridComponent, CanvasRenderer]);

export interface ChartTheme {
  /** Axis text: the chart element's own (muted) color. */
  textColor: string;
  /** Text drawn on the plot itself, e.g. bar value labels. */
  foregroundColor: string;
  gridColor: string;
  /** The panel surface, e.g. for gaps between treemap tiles. */
  cardColor: string;
  fontFamily: string;
}

/** ECharts draws on a canvas, so it needs resolved colors instead of CSS vars. */
function readChartTheme(element: HTMLElement): ChartTheme {
  const style = getComputedStyle(element);
  return {
    textColor: style.color,
    foregroundColor: style.getPropertyValue("--foreground").trim(),
    gridColor: style.getPropertyValue("--border").trim(),
    cardColor: style.getPropertyValue("--card").trim(),
    fontFamily: style.fontFamily,
  };
}

/**
 * A CSS color as the canvas needs it: `var(--x)` and other CSS-only syntax
 * resolve against `element`, so themed colors follow light and dark mode.
 */
export function resolveCssColor(element: HTMLElement, color: string): string {
  if (!color.includes("var(")) return color;
  const probe = document.createElement("span");
  probe.style.color = color;
  element.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || color;
}

interface MountedChart {
  chart: EChartsType;
  theme: ChartTheme;
  width: number;
  height: number;
}

/**
 * Owns an ECharts instance mounted on `elementRef` while `enabled`: creates it,
 * keeps it sized to the element, and disposes it. The instance is state, so
 * option effects that depend on it run once it exists, together with the
 * element's resolved theme and the chart's current width. `onResize` must be
 * stable; it runs after every resize, e.g. to drop a now-misplaced tooltip.
 */
export function useEChart(
  elementRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  onResize?: () => void,
): MountedChart | null {
  const [mounted, setMounted] = useState<MountedChart | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!enabled || !element) return;
    const instance = echarts.init(element, undefined, { renderer: "canvas" });
    const theme = readChartTheme(element);
    const measure = () => ({
      chart: instance,
      theme,
      width: instance.getWidth(),
      height: instance.getHeight(),
    });
    setMounted(measure());
    const observer = new ResizeObserver(() => {
      // The first report arrives right after observing, at the size the
      // chart was just created with: a resize then would lay it all out again.
      if (
        element.clientWidth === instance.getWidth() &&
        element.clientHeight === instance.getHeight()
      )
        return;
      instance.resize();
      setMounted(measure());
      onResize?.();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      instance.dispose();
      setMounted(null);
    };
  }, [elementRef, enabled, onResize]);

  // Between disposing an instance and mounting the next (a hot reload, or the
  // element changing), a render can still see the old one: hand out nothing
  // rather than an instance whose methods throw.
  return mounted && !mounted.chart.isDisposed() ? mounted : null;
}
