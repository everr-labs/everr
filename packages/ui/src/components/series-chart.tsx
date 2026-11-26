import { BrushArea, TOUCH_SCRUB, useBrush } from "@everr/ui/components/brush";
import { CursorLine } from "@everr/ui/components/cursor-line";
import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import {
  type LegendSeries,
  SeriesLegend,
  useSeriesLegend,
} from "@everr/ui/components/series-legend";
import { SeriesTooltipContent } from "@everr/ui/components/series-tooltip";
import { resolveCssColor, useEChart } from "@everr/ui/hooks/use-echart";
import { chartLabel } from "@everr/ui/lib/chart-label";
import { cn } from "@everr/ui/lib/utils";
import {
  BarChart,
  type BarSeriesOption,
  LineChart,
  type LineSeriesOption,
  ScatterChart,
  type ScatterSeriesOption,
} from "echarts/charts";
import { MarkAreaComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

echarts.use([BarChart, LineChart, ScatterChart, MarkAreaComponent]);

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
  /** Its values in the tooltip, when its unit isn't its axis's. */
  format?: (value: number) => string;
}

/** A point of interest drawn over the series, such as an exemplar. */
export interface ChartMarker {
  id: string;
  /** The x-axis point it sits on. */
  index: number;
  /** Its value on the left axis. */
  value: number;
  color: string;
  /** Names it in the hover tooltip. */
  label: string;
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
  /** Turns on drag to select a run of points, reported inclusive. A click
   *  selects nothing. */
  onSelect?: (from: number, to: number) => void;
  /** A finger drag selects too, instead of reading the values under it. */
  selectOnTouch?: boolean;
  /** Smaller text and insets, for small multiples. */
  compact?: boolean;
  /** Sizes the chart; it needs a height. */
  className?: string;
  /** The caller picked which points to label (the rest are ""): draw every
   *  label given, instead of a share of them chosen by spacing. */
  sparseLabels?: boolean;
  /** Curve lines between points. Off draws straight segments, so a reading
   *  shows exactly where each point lies. */
  smooth?: boolean;
  /** Drawn as diamonds over the series; a click on one reports it, with the
   *  pointer's viewport position, instead of starting a range drag. */
  markers?: readonly ChartMarker[];
  onMarkerClick?: (marker: ChartMarker, at: { x: number; y: number }) => void;
  /** A series to bring forward and dim the rest, e.g. the one hovered in a
   *  table beside the chart. It wins over the legend's pick while set. */
  focusedSeries?: string | null;
}

// How close the pointer must be to a marker to hover it, in pixels.
const MARKER_HIT_RADIUS = 8;

interface Pointer {
  index: number;
  x: number;
  y: number;
}

/**
 * The plot's top and height in the chart element, from what ECharts already
 * knows, so it reads no layout. (The grid box also holds the axis labels, so
 * its bottom is not the plot's.) ECharts keeps it on its internal model only.
 */
function plotSpan(chart: echarts.ECharts): { top: number; height: number } | null {
  const extent: unknown = Reflect.get(chart, "getModel")
    ?.call(chart)
    .getComponent("yAxis", 0)
    ?.axis?.getGlobalExtent();
  if (!Array.isArray(extent) || !extent.every(Number.isFinite)) return null;
  const top = Math.min(...extent);
  const height = Math.max(...extent) - top;
  return height > 0 ? { top, height } : null;
}

/** The cursor line through the hovered point: the middle of a bar's band, or
 * the point itself on lines. */
function PointCursor({ chart, index }: { chart: echarts.ECharts; index: number }) {
  const x = chart.convertToPixel({ xAxisIndex: 0 }, String(index));
  const plot = plotSpan(chart);
  if (typeof x !== "number" || !Number.isFinite(x) || !plot) return null;
  return <CursorLine style={{ left: x, ...plot }} />;
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
  selectOnTouch = false,
  compact = false,
  className,
  sparseLabels = false,
  smooth = true,
  markers,
  onMarkerClick,
  focusedSeries = null,
}: SeriesChartProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<ChartMarker | null>(null);
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

  // An id no longer charted would dim every line.
  const focused = series.some((s) => s.id === focusedSeries) ? focusedSeries : activeSeries;

  const shadeFrom = highlight?.from ?? null;
  const shadeTo = highlight?.to ?? null;

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
            ...(sparseLabels ? { interval: 0 } : {}),
            formatter: (_: string, index: number) => labels[index] ?? "",
          },
        },
        yAxis: [
          valueAxis(axes.left, true),
          ...(axes.right ? [{ ...valueAxis(axes.right, false), position: "right" as const }] : []),
        ],
        series: [
          ...series.flatMap(
            (s, index): (BarSeriesOption | LineSeriesOption | ScatterSeriesOption)[] => {
              const color = resolveCssColor(element, s.color);
              const opacity = focused !== null && focused !== s.id ? 0.25 : 1;
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
                // Drawn over the dimmed lines it crosses; markers stay on top.
                z: focused === s.id ? 3 : 2,
                markArea,
              };
              if (s.kind === "bar") {
                const top = !s.stack || stackTops.get(s.stack) === s.id;
                return [
                  {
                    ...common,
                    type: "bar",
                    stack: s.stack,
                    barMaxWidth: 48,
                    itemStyle: { color, opacity, borderRadius: top ? [2, 2, 0, 0] : 0 },
                  },
                ];
              }
              // A point with a gap on both sides has no segment to draw, so it
              // gets a dot. Only those points: a symbol on every point, even of
              // size 0, is one more element each to draw on every update.
              const isolated = s.values.flatMap((value, i) =>
                value != null && s.values[i - 1] == null && s.values[i + 1] == null
                  ? [[String(i), value]]
                  : [],
              );
              return [
                {
                  ...common,
                  type: "line",
                  smooth,
                  smoothMonotone: "x",
                  showSymbol: false,
                  lineStyle: { color, width: 1, opacity },
                  itemStyle: { color, opacity },
                  areaStyle: s.kind === "area" ? { color, opacity: 0.15 * opacity } : undefined,
                },
                ...(isolated.length > 0
                  ? [
                      {
                        id: `${s.id}\u0000isolated`,
                        type: "scatter",
                        silent: true,
                        yAxisIndex: common.yAxisIndex,
                        symbol: "circle",
                        symbolSize: compact ? 4 : 5,
                        itemStyle: { color, opacity },
                        data: isolated,
                      } satisfies ScatterSeriesOption,
                    ]
                  : []),
              ];
            },
          ),
          ...(markers && markers.length > 0
            ? [
                {
                  type: "scatter",
                  silent: true,
                  z: 5,
                  symbol: "diamond",
                  symbolSize: compact ? 7 : 9,
                  data: markers.map((m) => ({
                    value: [String(m.index), m.value],
                    itemStyle: {
                      color: theme.cardColor,
                      borderColor: resolveCssColor(element, m.color),
                      borderWidth: 1.5,
                    },
                  })),
                } satisfies ScatterSeriesOption,
              ]
            : []),
        ],
      },
      { notMerge: true },
    );
  }, [
    axes,
    chart,
    compact,
    focused,
    grid,
    labels,
    series,
    shadeFrom,
    shadeTo,
    sparseLabels,
    smooth,
    markers,
    theme,
  ]);

  /** The point under the pointer; outside the plot, null, or with
   * `clamped` the nearest point at its edge (a drag running past it). */
  /** Where the pointer is along the x axis, in points, between them too. */
  const indexAt = (event: PointerEvent, clamped = false): number | null => {
    const element = elementRef.current;
    if (!chart || !element || labels.length === 0) return null;
    const bounds = element.getBoundingClientRect();
    const pixel = [event.clientX - bounds.left, event.clientY - bounds.top];
    if (!clamped && !chart.containPixel({ gridIndex: 0 }, pixel)) return null;
    const raw = chart.convertFromPixel({ xAxisIndex: 0 }, pixel[0]);
    if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
    return Math.max(0, Math.min(labels.length - 1, raw));
  };
  const pointAt = (event: PointerEvent, clamped = false): Pointer | null => {
    const index = indexAt(event, clamped);
    return index === null ? null : { index: Math.round(index), x: event.clientX, y: event.clientY };
  };

  /** The marker within reach of the pointer, nearest first. */
  const markerAt = (event: PointerEvent): ChartMarker | null => {
    const element = elementRef.current;
    if (!chart || !element || !markers || markers.length === 0) return null;
    const bounds = element.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    let nearest: ChartMarker | null = null;
    let nearestDistance = MARKER_HIT_RADIUS;
    for (const marker of markers) {
      const pixel: unknown = chart.convertToPixel({ gridIndex: 0 }, [
        String(marker.index),
        marker.value,
      ]);
      if (!Array.isArray(pixel)) continue;
      const [mx, my] = pixel;
      if (typeof mx !== "number" || typeof my !== "number") continue;
      const distance = Math.hypot(mx - x, my - y);
      if (distance <= nearestDistance) {
        nearest = marker;
        nearestDistance = distance;
      }
    }
    return nearest;
  };

  const showPointer = (event: PointerEvent) =>
    setPointer(isOnLegend(event.target) ? null : pointAt(event));
  // Positions run between points, so a press that doesn't move sideways
  // selects nothing; the range covers the points nearest its ends.
  const zoom = useBrush({
    positionAt: (event, clamped) => {
      if (
        !onSelect ||
        (!clamped && (isOnLegend(event.target) || (onMarkerClick && markerAt(event))))
      )
        return null;
      return indexAt(event, clamped);
    },
    onSelect: (from, to) => onSelect?.(Math.round(from), Math.round(to)),
    onTouch: showPointer,
    onTouchCancel: () => setPointer(null),
    touchSelects: selectOnTouch,
  });
  const selected = zoom.range && zoom.range.map(Math.round);

  const handlePointerMove = (event: PointerEvent) => {
    if (!zoom.dragging) setHoveredMarker(markerAt(event));
    zoom.handlers.onPointerMove(event);
    showPointer(event);
  };

  const handlePointerUp = (event: PointerEvent) => {
    const marker = !zoom.dragging && onMarkerClick ? markerAt(event) : null;
    if (marker) onMarkerClick?.(marker, { x: event.clientX, y: event.clientY });
    zoom.handlers.onPointerUp();
  };

  const brush = (() => {
    if (!selected || !chart) return null;
    // Each point stands for a bucket one step wide: a bar's is centered on
    // it, a line point's runs to the next point. A line's last bucket would
    // end past the plot, so the brush stops at the last point.
    const bars = series.some((s) => s.kind === "bar");
    const x = (index: number) => chart.convertToPixel({ xAxisIndex: 0 }, String(index));
    const step = labels.length > 1 ? x(1) - x(0) : 0;
    const bucketStart = (index: number) => x(index) - (bars ? step / 2 : 0);
    const plotEnd = bucketStart(labels.length - 1) + (bars ? step : 0);
    const start = bucketStart(selected[0]);
    const end = Math.min(bucketStart(selected[1]) + step, plotEnd);
    const plot = plotSpan(chart);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !plot) return null;
    return { start, size: end - start, ...plot };
  })();

  const rows = pointer
    ? [
        ...(hoveredMarker
          ? [
              {
                key: `marker:${hoveredMarker.id}`,
                color: hoveredMarker.color,
                label: hoveredMarker.label,
                value: axes.left.format(hoveredMarker.value),
                active: true,
              },
            ]
          : []),
        ...series.flatMap(({ id, label, color, values, rightAxis, format: own }) => {
          const value = values[pointer.index];
          if (typeof value !== "number" || (activeSeries !== null && id !== activeSeries))
            return [];
          const format = own ?? (rightAxis && axes.right ? axes.right.format : axes.left.format);
          return [{ key: id, color, label, value: format(value) }];
        }),
      ]
    : [];

  return (
    <div
      data-slot="series-chart"
      className={cn(
        "relative text-muted-foreground",
        TOUCH_SCRUB,
        onSelect && "select-none",
        hoveredMarker && onMarkerClick && "cursor-pointer",
        className,
      )}
      onPointerMove={handlePointerMove}
      onPointerDown={zoom.handlers.onPointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={zoom.handlers.onPointerCancel}
      onPointerLeave={() => {
        setPointer(null);
        setHoveredMarker(null);
      }}
    >
      {/* Hover is ours: ECharts would track the pointer too, forcing a layout per move. */}
      {/* The canvas has no text of its own: say what it shows. */}
      <p className="sr-only">
        {chartLabel(
          "Chart",
          series.map(({ label }) => label),
        )}
      </p>
      <div ref={elementRef} aria-hidden className="pointer-events-none h-full w-full" />
      {pointer && chart && <PointCursor chart={chart} index={pointer.index} />}
      {brush && (
        <div
          className="pointer-events-none absolute inset-x-0"
          style={{ top: brush.top, height: brush.height }}
        >
          <BrushArea start={brush.start} size={brush.size} />
        </div>
      )}
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
