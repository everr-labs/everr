import { CursorLine } from "@everr/ui/components/cursor-line";
import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import {
  type LegendSeries,
  SeriesLegend,
  useSeriesLegend,
} from "@everr/ui/components/series-legend";
import { SeriesTooltipContent } from "@everr/ui/components/series-tooltip";
import { resolveCssColor, useEChart } from "@everr/ui/hooks/use-echart";
import { cn } from "@everr/ui/lib/utils";
import { BarChart, type BarSeriesOption, LineChart, type LineSeriesOption } from "echarts/charts";
import { MarkAreaComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

echarts.use([BarChart, LineChart, MarkAreaComponent]);

export interface ChartSeries {
  id: string;
  label: string;
  /** Any CSS color, including `var(--token)`. */
  color: string;
  kind: "bar" | "line" | "area";
  /** One value per x-axis point; null is a gap. */
  values: readonly (number | null)[];
  /** The right value axis instead of the left one. */
  rightAxis?: boolean;
  /** Bars sharing a stack id pile up. */
  stack?: string;
}

export interface ChartValueAxis {
  format: (value: number) => string;
  min?: number;
  max?: number;
  /** Scales the series without drawing labels or grid lines. */
  hidden?: boolean;
  /** Exact tick positions, e.g. rounded in the displayed unit, labeled with
   * `tickFormat` (default `format`). */
  ticks?: readonly number[];
  tickFormat?: (value: number) => string;
}

/** `labels`, `series` and `axes` are effect inputs: keep them stable. */
interface SeriesChartProps {
  /** The x-axis label of each point. */
  labels: readonly string[];
  /** The tooltip heading of each point, when it says more than the label. */
  titles?: readonly string[];
  series: readonly ChartSeries[];
  axes: { left: ChartValueAxis; right?: ChartValueAxis };
  showLegend?: boolean;
  /** Points to shade, inclusive, e.g. a selected step's window. */
  highlight?: { from: number; to: number } | null;
  /** Turns on drag to select a run of points, reported inclusive. */
  onSelect?: (from: number, to: number) => void;
  /** Smaller text and insets, for small multiples. */
  compact?: boolean;
  /** Sizes the chart; it needs a height. */
  className?: string;
}

interface Pointer {
  index: number;
  x: number;
  y: number;
}

/**
 * The cursor line through the hovered point: the middle of a bar's band, or
 * the point itself on lines. It runs from the top of the plot to the value
 * axis baseline, positioned from what ECharts already knows, so it reads no
 * layout. (The grid box also holds the axis labels, so its bottom is not the
 * plot's.)
 */
function PointCursor({
  chart,
  top,
  index,
}: {
  chart: echarts.ECharts;
  top: number;
  index: number;
}) {
  const x = chart.convertToPixel({ xAxisIndex: 0 }, String(index));
  const baseline = chart.convertToPixel({ yAxisIndex: 0 }, 0);
  if (typeof x !== "number" || typeof baseline !== "number") return null;
  if (!Number.isFinite(x) || !(baseline > top)) return null;
  return <CursorLine style={{ left: x, top, height: baseline - top }} />;
}

/**
 * A bar, line or area chart over a shared category axis, with the app's
 * hover tooltip and click-to-isolate legend. Series may stack and may use a
 * second value axis on the right.
 */
export function SeriesChart({
  labels,
  titles,
  series,
  axes,
  showLegend = false,
  highlight,
  onSelect,
  compact = false,
  className,
}: SeriesChartProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const clearPointer = useCallback(() => setPointer(null), []);
  const mounted = useEChart(elementRef, true, clearPointer);
  const chart = mounted?.chart ?? null;
  const theme = mounted?.theme ?? null;

  const legendSeries = useMemo<LegendSeries[]>(
    () => series.map(({ id, label, color }) => ({ id, identity: id, label, color })),
    [series],
  );
  const { activeSeries, toggleSeries, isOnLegend, gridBottom, legend } = useSeriesLegend(
    legendSeries,
    showLegend,
  );

  const grid = useMemo(
    () => ({
      left: compact ? 2 : 8,
      right: compact ? 4 : 8,
      top: compact ? 6 : 10,
      bottom: showLegend ? gridBottom : compact ? 2 : 4,
    }),
    [compact, gridBottom, showLegend],
  );

  const shadeFrom = drag ? Math.min(drag.from, drag.to) : (highlight?.from ?? null);
  const shadeTo = drag ? Math.max(drag.from, drag.to) : (highlight?.to ?? null);

  useEffect(() => {
    const element = elementRef.current;
    if (!chart || !theme || !element) return;
    const fontSize = compact ? 9 : 11;
    const text = { color: theme.textColor, fontFamily: theme.fontFamily, fontSize };
    const hasBars = series.some((s) => s.kind === "bar");
    const valueAxis = (axis: ChartValueAxis, grid: boolean) => {
      const format = axis.tickFormat ?? axis.format;
      const customValues = axis.ticks ? [...axis.ticks] : undefined;
      return {
        type: "value" as const,
        min: axis.min,
        max: axis.max,
        // The tick values also place the split lines.
        axisTick: { show: false, customValues },
        axisLabel: {
          ...text,
          show: !axis.hidden,
          customValues,
          formatter: (value: number) => format(value),
        },
        splitLine: { show: grid && !axis.hidden, lineStyle: { color: theme.gridColor } },
      };
    };
    const stackTops = new Map(series.filter((s) => s.stack).map((s) => [s.stack, s.id]));
    const shade = resolveCssColor(element, "var(--primary)");
    const shadeData: [{ xAxis: string }, { xAxis: string }][] = [
      [{ xAxis: String(shadeFrom) }, { xAxis: String(shadeTo) }],
    ];

    chart.setOption(
      {
        animation: false,
        grid,
        xAxis: {
          type: "category",
          // Index keys: two points can share a display label.
          data: labels.map((_, index) => String(index)),
          boundaryGap: hasBars,
          axisLine: { show: false },
          // Every category gets a tick, though none is drawn: the shaded
          // range snaps to ticks, and only labelled ones would leave it
          // spanning more bars than selected.
          axisTick: { show: false, interval: 0 },
          axisLabel: {
            ...text,
            hideOverlap: true,
            formatter: (_: string, index: number) => labels[index] ?? "",
          },
        },
        yAxis: [
          valueAxis(axes.left, true),
          ...(axes.right ? [{ ...valueAxis(axes.right, false), position: "right" as const }] : []),
        ],
        series: series.map((s, index): BarSeriesOption | LineSeriesOption => {
          const color = resolveCssColor(element, s.color);
          const opacity = activeSeries !== null && activeSeries !== s.id ? 0.25 : 1;
          const markArea =
            index === 0 && shadeFrom !== null && shadeTo !== null
              ? {
                  silent: true,
                  itemStyle: {
                    color: shade,
                    opacity: 0.08,
                    borderColor: shade,
                    borderWidth: 1,
                    borderType: "dashed" as const,
                  },
                  data: shadeData,
                }
              : undefined;
          const common = {
            id: s.id,
            data: [...s.values],
            yAxisIndex: s.rightAxis && axes.right ? 1 : 0,
            silent: true,
            markArea,
          };
          if (s.kind === "bar") {
            const top = !s.stack || stackTops.get(s.stack) === s.id;
            return {
              ...common,
              type: "bar",
              stack: s.stack,
              barMaxWidth: 48,
              itemStyle: { color, opacity, borderRadius: top ? [2, 2, 0, 0] : 0 },
            };
          }
          return {
            ...common,
            type: "line",
            smooth: true,
            smoothMonotone: "x",
            showSymbol: false,
            lineStyle: { color, width: compact ? 1.5 : 2, opacity },
            itemStyle: { color },
            areaStyle: s.kind === "area" ? { color, opacity: 0.15 * opacity } : undefined,
          };
        }),
      },
      { notMerge: true },
    );
  }, [activeSeries, axes, chart, compact, grid, labels, series, shadeFrom, shadeTo, theme]);

  /** The point under the pointer; outside the plot, null, or with
   * `clamped` the nearest point at its edge (a drag running past it). */
  const pointAt = (event: PointerEvent, clamped = false): Pointer | null => {
    const element = elementRef.current;
    if (!chart || !element || labels.length === 0) return null;
    const bounds = element.getBoundingClientRect();
    const pixel = [event.clientX - bounds.left, event.clientY - bounds.top];
    if (!clamped && !chart.containPixel({ gridIndex: 0 }, pixel)) return null;
    const raw = chart.convertFromPixel({ xAxisIndex: 0 }, pixel[0]);
    if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
    const index = Math.max(0, Math.min(labels.length - 1, Math.round(raw)));
    return { index, x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (drag) {
      const point = pointAt(event, true);
      if (point) setDrag({ ...drag, to: point.index });
    }
    setPointer(isOnLegend(event.target) ? null : pointAt(event));
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!onSelect || isOnLegend(event.target)) return;
    const point = pointAt(event);
    if (!point) return;
    setDrag({ from: point.index, to: point.index });
    // Keep the drag when it runs past the chart's edge.
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerUp = () => {
    if (drag && onSelect) onSelect(Math.min(drag.from, drag.to), Math.max(drag.from, drag.to));
    setDrag(null);
  };

  const rows = pointer
    ? series.flatMap(({ id, label, color, values, rightAxis }) => {
        const value = values[pointer.index];
        if (typeof value !== "number" || (activeSeries !== null && id !== activeSeries)) return [];
        const format = rightAxis && axes.right ? axes.right.format : axes.left.format;
        return [{ key: id, color, label, value: format(value) }];
      })
    : [];

  return (
    <div
      data-slot="series-chart"
      className={cn("relative text-muted-foreground", onSelect && "select-none", className)}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => setPointer(null)}
    >
      {/* Hover is ours: ECharts would track the pointer too, forcing a layout per move. */}
      <div ref={elementRef} className="pointer-events-none h-full w-full" />
      {pointer && chart && <PointCursor chart={chart} top={grid.top} index={pointer.index} />}
      {showLegend && <SeriesLegend {...legend} onToggle={toggleSeries} />}
      {pointer && rows.length > 0 && (
        <CursorTooltip x={pointer.x} y={pointer.y}>
          <SeriesTooltipContent
            title={titles?.[pointer.index] ?? labels[pointer.index] ?? ""}
            rows={rows}
          />
        </CursorTooltip>
      )}
    </div>
  );
}
