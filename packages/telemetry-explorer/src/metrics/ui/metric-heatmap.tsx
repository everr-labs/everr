import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import { SeriesTooltipContent } from "@everr/ui/components/series-tooltip";
import { resolveCssColor, useEChart } from "@everr/ui/hooks/use-echart";
import { HeatmapChart } from "echarts/charts";
import { VisualMapContinuousComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MetricHeatmap } from "../data/types";
import { ACCENT_COLOR } from "@everr/ui/lib/series-colors";
import { formatMetricValue } from "./format";

echarts.use([HeatmapChart, VisualMapContinuousComponent]);

const count = new Intl.NumberFormat();

/** A label per histogram bucket, low to high: "≤ 100 ms", then "> 1 s" for
 *  the bucket above the last bound. */
export function bucketLabels(bounds: readonly number[], unit: string): string[] {
  const last = bounds.at(-1);
  return [
    ...bounds.map((b) => `≤ ${formatMetricValue(b, unit)}`),
    ...(last === undefined ? [] : [`> ${formatMetricValue(last, unit)}`]),
  ];
}

/**
 * Observations per histogram bucket over time: one column per interval, one
 * row per bucket, darker where more observations fell. Color follows the
 * square root of the count, so a long tail of rare slow requests stays
 * visible next to the busy buckets.
 */
export function MetricHeatmap({
  heatmap,
  labels,
  titles,
  unit,
  className,
}: {
  heatmap: MetricHeatmap;
  /** The x-axis label of each interval, "" where none is drawn. */
  labels: readonly string[];
  /** The tooltip heading of each interval. */
  titles: readonly string[];
  unit: string;
  className?: string;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [pointer, setPointer] = useState<{
    column: number;
    row: number;
    x: number;
    y: number;
  } | null>(null);
  const clearPointer = useCallback(() => setPointer(null), []);
  const mounted = useEChart(elementRef, true, clearPointer);

  const rows = useMemo(() => bucketLabels(heatmap.bounds, unit), [heatmap.bounds, unit]);
  const max = useMemo(
    () => Math.max(0, ...heatmap.counts.flatMap((column) => column)),
    [heatmap.counts],
  );

  useEffect(() => {
    const element = elementRef.current;
    if (!mounted || !element) return;
    const { chart, theme } = mounted;
    const text = { color: theme.textColor, fontFamily: theme.fontFamily, fontSize: 11 };
    const data = heatmap.counts.flatMap((column, x) =>
      column.flatMap((value, y) => (value > 0 ? [[x, y, Math.sqrt(value)]] : [])),
    );
    chart.setOption(
      {
        animation: false,
        grid: { left: 8, right: 8, top: 10, bottom: 4, containLabel: true },
        xAxis: {
          type: "category",
          data: labels.map((_, i) => String(i)),
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            ...text,
            interval: 0,
            formatter: (_: string, index: number) => labels[index] ?? "",
          },
        },
        yAxis: {
          type: "category",
          data: rows,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: text,
        },
        visualMap: {
          type: "continuous",
          show: false,
          dimension: 2,
          min: 0,
          max: Math.sqrt(max) || 1,
          inRange: {
            color: [
              resolveCssColor(element, `color-mix(in oklab, ${ACCENT_COLOR} 12%, transparent)`),
              resolveCssColor(element, ACCENT_COLOR),
            ],
          },
        },
        series: [{ type: "heatmap", silent: true, progressive: 0, data }],
      },
      { notMerge: true },
    );
  }, [mounted, heatmap.counts, labels, rows, max]);

  const handlePointerMove = (event: PointerEvent) => {
    const element = elementRef.current;
    const chart = mounted?.chart;
    if (!element || !chart) return;
    const bounds = element.getBoundingClientRect();
    const pixel = [event.clientX - bounds.left, event.clientY - bounds.top];
    if (!chart.containPixel({ gridIndex: 0 }, pixel)) {
      setPointer(null);
      return;
    }
    const point: unknown = chart.convertFromPixel({ gridIndex: 0 }, pixel);
    const [column, row] = Array.isArray(point) ? point : [];
    if (typeof column !== "number" || typeof row !== "number") {
      setPointer(null);
      return;
    }
    setPointer({ column, row, x: event.clientX, y: event.clientY });
  };

  const observed = pointer ? heatmap.counts[pointer.column]?.[pointer.row] : undefined;

  return (
    <div
      className={`relative ${className ?? ""}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setPointer(null)}
    >
      <p className="sr-only">Heatmap of observations per histogram bucket over time</p>
      <div ref={elementRef} aria-hidden className="pointer-events-none h-full w-full" />
      {pointer && observed !== undefined ? (
        <CursorTooltip x={pointer.x} y={pointer.y}>
          <SeriesTooltipContent
            title={titles[pointer.column]}
            rows={[
              {
                key: "bucket",
                color: ACCENT_COLOR,
                label: rows[pointer.row] ?? "",
                // Interpolated counts are estimates, and fractions of a
                // request read as false precision.
                value: Number.isInteger(observed)
                  ? count.format(observed)
                  : `≈ ${count.format(Math.round(observed))}`,
              },
            ]}
          />
        </CursorTooltip>
      ) : null}
    </div>
  );
}
