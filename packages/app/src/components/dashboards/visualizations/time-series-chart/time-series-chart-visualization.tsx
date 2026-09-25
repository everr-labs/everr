import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import { SeriesTooltipContent } from "@everr/ui/components/series-tooltip";
import { cn } from "@everr/ui/lib/utils";
import type { LineSeriesOption } from "echarts/charts";
import { LineChart } from "echarts/charts";
import type { GridComponentOption } from "echarts/components";
import { GridComponent } from "echarts/components";
import type { ComposeOption, EChartsType } from "echarts/core";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { LineChart as LineChartIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  markerTolerance,
  nearestSeriesKeys,
  valueAtCursorY,
} from "../chart-hover";
import {
  createTimeTickFormatter,
  niceLinearDomain,
  SERIES_COLORS,
} from "../data-utils";
import type { VisualizationProps } from "../index";
import { createValueFormatter } from "../value-format";
import { useSharedTimeCursor } from "./shared-time-cursor";
import type { TimeSeriesChartSpec } from "./spec";
import { buildChartModel, buildStackedData, TS_KEY } from "./time-series-data";

const BRUSH_COLOR = SERIES_COLORS[0] ?? "hsl(263, 90%, 65%)";
const PLAIN_MARKER_RADIUS = 4;
const ACTIVE_MARKER_RADIUS = 6;
const AXIS_LABEL_MARGIN = 8;
const VALUE_AXIS_EDGE_INSET = 8;

echarts.use([LineChart, GridComponent, CanvasRenderer]);

type ChartOption = ComposeOption<LineSeriesOption | GridComponentOption>;
type PlotRect = { left: number; top: number; width: number; height: number };

function getPlotArea(
  chart: EChartsType,
  container: HTMLElement,
  domain: [number, number],
  valueDomain: [number, number],
): PlotRect | null {
  const left = chart.convertToPixel({ xAxisIndex: 0 }, domain[0]);
  const right = chart.convertToPixel({ xAxisIndex: 0 }, domain[1]);
  const top = chart.convertToPixel({ yAxisIndex: 0 }, valueDomain[1]);
  const bottom = chart.convertToPixel({ yAxisIndex: 0 }, valueDomain[0]);
  if (
    typeof left !== "number" ||
    typeof right !== "number" ||
    typeof top !== "number" ||
    typeof bottom !== "number" ||
    ![left, right, top, bottom].every(Number.isFinite) ||
    right <= left ||
    bottom <= top
  ) {
    return null;
  }
  const bounds = container.getBoundingClientRect();
  return {
    left: bounds.left + left,
    top: bounds.top + top,
    width: right - left,
    height: bottom - top,
  };
}

function pxToTimestamp(
  clientX: number,
  plotRect: PlotRect,
  domain: [number, number],
): number {
  const ratio = Math.max(
    0,
    Math.min(1, (clientX - plotRect.left) / plotRect.width),
  );
  return domain[0] + ratio * (domain[1] - domain[0]);
}

function curveOptions(
  curveType: TimeSeriesChartSpec["curveType"],
): Pick<LineSeriesOption, "smooth" | "smoothMonotone" | "step"> {
  switch (curveType) {
    case "monotone":
      return { smooth: true, smoothMonotone: "x" };
    case "natural":
      return { smooth: true };
    case "stepBefore":
      return { step: "start" };
    case "stepAfter":
      return { step: "end" };
    default:
      return { smooth: false };
  }
}

export function TimeSeriesChartVisualization({
  spec,
  data,
  timeRange,
  onTimeRangeChange,
}: VisualizationProps<TimeSeriesChartSpec>) {
  const formatter = useMemo(
    () => createValueFormatter(spec.valueFormat),
    [spec.valueFormat],
  );
  const {
    showLegend,
    connectNulls,
    lineWidth,
    curveType,
    stacked,
    yAxis: yAxisSpec,
  } = spec;

  const containerRef = useRef<HTMLDivElement>(null);
  const chartElementRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const cursorSourceRef = useRef(Symbol("time-series-chart"));
  const { cursor, store: cursorStore } = useSharedTimeCursor();
  const plotRectRef = useRef<PlotRect | null>(null);
  const [brushStart, setBrushStart] = useState<number | null>(null);
  const [brushEnd, setBrushEnd] = useState<number | null>(null);
  const [focusedSeries, setFocusedSeries] = useState<string | null>(null);
  const [tooltipState, setTooltipState] = useState<{
    clientX: number;
    clientY: number;
    index: number;
    timestamp: number;
    /** The pointer's height as a value on the y axis; null if unmeasurable. */
    cursorValue: number | null;
    /** How near `cursorValue` a series counts as pointed at, in value units. */
    tolerance: number;
  } | null>(null);

  const domain = useMemo<[number, number]>(
    () => [timeRange.from.getTime(), timeRange.to.getTime()],
    [timeRange],
  );

  const { chartData, series: modelSeries } = useMemo(
    () => buildChartModel(data ?? [], domain),
    [data, domain],
  );
  const activeSeries =
    focusedSeries && modelSeries.some(({ id }) => id === focusedSeries)
      ? focusedSeries
      : null;

  const stackedData = useMemo(
    () => (stacked ? buildStackedData(chartData, modelSeries) : null),
    [stacked, chartData, modelSeries],
  );

  // Measure over what is actually drawn: the stacked
  // tops when stacking, otherwise each line's own samples (which can reach one
  // bucket left of the x domain).
  const yAxis = useMemo(() => {
    let lo = stackedData ? 0 : Number.POSITIVE_INFINITY;
    let hi = stackedData ? 0 : Number.NEGATIVE_INFINITY;
    if (stackedData) {
      for (let i = 0; i < chartData.length; i++) {
        let top = 0;
        for (const points of stackedData) {
          const v = points[i]?.[1];
          if (typeof v === "number") top += v;
        }
        lo = Math.min(lo, top);
        hi = Math.max(hi, top);
      }
    } else {
      for (const { data: points } of modelSeries) {
        for (const [, v] of points) {
          if (typeof v === "number") {
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        }
      }
    }
    return niceLinearDomain(lo, hi, 5, {
      min: typeof yAxisSpec?.min === "number" ? yAxisSpec.min : undefined,
      max: typeof yAxisSpec?.max === "number" ? yAxisSpec.max : undefined,
    });
  }, [chartData.length, stackedData, modelSeries, yAxisSpec]);
  const formatAxisValue = useMemo(
    () => formatter.axis(Math.max(...yAxis.domain.map(Math.abs))),
    [formatter, yAxis],
  );
  const hasChart = !!data && chartData.length > 0 && modelSeries.length > 0;

  useEffect(() => {
    const element = chartElementRef.current;
    if (!hasChart || !element) return;
    const chart = echarts.init(element, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => {
      chart.resize();
      setTooltipState(null);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [hasChart]);

  useEffect(
    () => () => cursorStore.clear(cursorSourceRef.current),
    [cursorStore],
  );

  useEffect(() => {
    const legend = legendRef.current;
    if (!legend) return;
    const observer = new ResizeObserver(() => {
      chartRef.current?.setOption({
        grid: { bottom: Math.max(58, legend.offsetHeight + 30) },
      });
    });
    observer.observe(legend);
    return () => observer.disconnect();
  }, [hasChart, showLegend]);

  useEffect(() => {
    const chart = chartRef.current;
    const element = chartElementRef.current;
    if (!chart || !element) return;
    const style = getComputedStyle(element);
    const textColor = style.color;
    const gridColor = style.getPropertyValue("--border").trim();
    const timeFormat = createTimeTickFormatter(domain);
    const compactTimeFormat = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const axisFont = `12px ${style.fontFamily}`;
    const measureContext = document.createElement("canvas").getContext("2d");
    if (measureContext) measureContext.font = axisFont;
    const axisWidth = Math.ceil(
      Math.max(
        0,
        ...yAxis.ticks.map((tick) => {
          const label = formatAxisValue(tick);
          return measureContext
            ? measureContext.measureText(label).width
            : label.length * 7;
        }),
      ) +
        AXIS_LABEL_MARGIN +
        VALUE_AXIS_EDGE_INSET,
    );
    const series: LineSeriesOption[] = modelSeries.map((item, index) => {
      const { id, color } = item;
      const points = stackedData?.[index] ?? item.data;
      const dimmed = activeSeries !== null && activeSeries !== id;
      return {
        id,
        name: id,
        type: "line",
        data: points,
        showSymbol: false,
        connectNulls: !stacked && connectNulls,
        silent: true,
        clip: true,
        stack: stacked ? "stack" : undefined,
        areaStyle: stacked
          ? { color, opacity: dimmed ? 0.06 : 0.4 }
          : undefined,
        lineStyle: { color, width: lineWidth, opacity: dimmed ? 0.15 : 1 },
        itemStyle: { color },
        ...curveOptions(curveType),
      };
    });
    const option: ChartOption = {
      animation: false,
      grid: {
        left: axisWidth,
        right: 0,
        top: 0,
        bottom: showLegend
          ? Math.max(58, (legendRef.current?.offsetHeight ?? 0) + 30)
          : 32,
      },
      xAxis: {
        type: "time",
        min: domain[0],
        max: domain[1],
        splitNumber: 6,
        minInterval:
          domain[1] - domain[0] > 86_400_000 ? 86_400_000 : undefined,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: textColor,
          fontFamily: style.fontFamily,
          fontSize: 12,
          margin: AXIS_LABEL_MARGIN,
          hideOverlap: true,
          formatter: (value: number) =>
            domain[1] - domain[0] > 86_400_000
              ? timeFormat(value)
              : compactTimeFormat.format(value),
        },
      },
      yAxis: {
        type: "value",
        min: yAxis.domain[0],
        max: yAxis.domain[1],
        interval:
          typeof yAxisSpec?.min === "number" ||
          typeof yAxisSpec?.max === "number"
            ? undefined
            : (yAxis.ticks[1] ?? yAxis.domain[1]) -
              (yAxis.ticks[0] ?? yAxis.domain[0]),
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: gridColor, opacity: 0.5 } },
        axisLabel: {
          color: textColor,
          fontFamily: style.fontFamily,
          fontSize: 12,
          margin: AXIS_LABEL_MARGIN,
          formatter: (value: number) => formatAxisValue(value),
        },
      },
      series,
    };
    chart.setOption(option, { notMerge: true });
  }, [
    activeSeries,
    modelSeries,
    connectNulls,
    curveType,
    domain,
    formatAxisValue,
    hasChart,
    lineWidth,
    showLegend,
    stacked,
    stackedData,
    yAxis,
    yAxisSpec,
  ]);

  const handleChartMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (legendRef.current?.contains(e.target as Node)) {
        setTooltipState(null);
        cursorStore.clear(cursorSourceRef.current);
        return;
      }
      const chart = chartRef.current;
      const container = containerRef.current;
      if (!chart || !container || chartData.length === 0) return;
      const plotRect = getPlotArea(chart, container, domain, yAxis.domain);
      if (!plotRect) return;
      const ts = pxToTimestamp(e.clientX, plotRect, domain);
      const first = chartData[0];
      if (!first) return;
      let nearest = 0;
      let minDist = Math.abs((first[TS_KEY] as number) - ts);
      for (let i = 1; i < chartData.length; i++) {
        const row = chartData[i];
        if (!row) continue;
        const dist = Math.abs((row[TS_KEY] as number) - ts);
        if (dist < minDist) {
          minDist = dist;
          nearest = i;
        }
      }
      const hoveredRow = chartData[nearest];
      if (!hoveredRow) return;
      cursorStore.set(cursorSourceRef.current, hoveredRow[TS_KEY] as number);
      setTooltipState({
        clientX: e.clientX,
        clientY: e.clientY,
        index: nearest,
        timestamp: hoveredRow[TS_KEY] as number,
        cursorValue: valueAtCursorY(
          e.clientY,
          { top: plotRect.top, height: plotRect.height },
          yAxis.domain,
        ),
        tolerance: markerTolerance(
          plotRect.height,
          yAxis.domain[1] - yAxis.domain[0],
        ),
      });
    },
    [domain, chartData, cursorStore, yAxis],
  );

  const handleChartMouseLeave = useCallback(() => {
    setTooltipState(null);
    cursorStore.clear(cursorSourceRef.current);
  }, [cursorStore]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (legendRef.current?.contains(e.target as Node)) return;
      const chart = chartRef.current;
      const container = containerRef.current;
      if (!chart || !container) return;
      const plotRect = getPlotArea(chart, container, domain, yAxis.domain);
      if (!plotRect) return;
      plotRectRef.current = plotRect;
      const ts = pxToTimestamp(e.clientX, plotRect, domain);
      setBrushStart(ts);
      setBrushEnd(null);
      container.setPointerCapture(e.pointerId);
    },
    [domain, yAxis],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (brushStart == null || !plotRectRef.current) return;
      const ts = pxToTimestamp(e.clientX, plotRectRef.current, domain);
      setBrushEnd(ts);
    },
    [brushStart, domain],
  );

  const handlePointerUp = useCallback(() => {
    if (brushStart != null && brushEnd != null) {
      const from = Math.min(brushStart, brushEnd);
      const to = Math.max(brushStart, brushEnd);
      if (to - from > 1000) {
        setTooltipState(null);
        onTimeRangeChange({ from: new Date(from), to: new Date(to) });
      }
    }
    setBrushStart(null);
    setBrushEnd(null);
    plotRectRef.current = null;
  }, [brushStart, brushEnd, onTimeRangeChange]);

  const handlePointerCancel = useCallback(() => {
    setBrushStart(null);
    setBrushEnd(null);
    plotRectRef.current = null;
  }, []);

  // No series means rows came back but none had a numeric column
  // to plot — buildChartModel still emits timestamp-only entries, so guard on it
  // explicitly instead of letting an axis-only, line-less chart render.
  if (!hasChart) {
    const message = !data
      ? "Configure a query to see results"
      : chartData.length === 0
        ? "No data in this time range"
        : "No numeric data to plot";
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <LineChartIcon className="size-8" />
        <p className="text-sm">{message}</p>
      </div>
    );
  }

  const hoveredRow = tooltipState ? chartData[tooltipState.index] : undefined;
  const tooltipRow =
    hoveredRow?.[TS_KEY] === tooltipState?.timestamp ? hoveredRow : undefined;
  const tooltipTs = tooltipRow ? (tooltipRow[TS_KEY] as number) : undefined;

  // Where each series is drawn at the hovered instant. Stacked series sit at
  // their cumulative top (the running sum in render order), which is where the
  // band edge is, not at the raw value.
  let stackTop = 0;
  const hoverPoints = modelSeries
    .map(({ id, color }) => {
      const val = tooltipRow?.[id];
      stackTop += typeof val === "number" ? val : 0;
      return {
        key: id,
        value:
          typeof val !== "number" ? null : stacked ? stackTop : (val as number),
        color,
      };
    })
    .filter((point) => activeSeries === null || point.key === activeSeries);

  // Which of them the pointer is actually on. Several series can share a value
  // (two at zero is routine), so this names every one of them.
  const nearestKeys = nearestSeriesKeys(
    hoverPoints,
    tooltipState?.cursorValue ?? null,
    tooltipState?.tolerance ?? 0,
  );
  const chart = chartRef.current;
  const container = containerRef.current;
  const plot =
    chart && container
      ? getPlotArea(chart, container, domain, yAxis.domain)
      : null;
  const bounds = container?.getBoundingClientRect();
  const localX = (timestamp: number) =>
    plot && bounds
      ? plot.left -
        bounds.left +
        ((timestamp - domain[0]) / (domain[1] - domain[0])) * plot.width
      : 0;
  const crosshairTs = cursor?.timestamp ?? tooltipTs;
  const crosshairX = crosshairTs === undefined ? null : localX(crosshairTs);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: chart interaction area
    <div
      ref={containerRef}
      className="relative h-full w-full select-none text-muted-foreground"
      onMouseMove={handleChartMouseMove}
      onMouseLeave={handleChartMouseLeave}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div ref={chartElementRef} className="h-full w-full" />
      {showLegend && (
        <section
          ref={legendRef}
          className="pointer-events-auto absolute inset-x-0 bottom-0 flex items-center justify-start gap-4 overflow-x-auto p-3 text-xs text-foreground"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need to scroll overflowing series legends
          tabIndex={0}
          aria-label="Series legend"
        >
          {modelSeries.map(({ id, label, color }) => (
            <button
              key={id}
              type="button"
              aria-pressed={activeSeries === id}
              className={cn(
                "flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2",
                activeSeries !== null && activeSeries !== id && "opacity-40",
              )}
              onClick={() => {
                setFocusedSeries((current) => (current === id ? null : id));
                setTooltipState(null);
                cursorStore.clear(cursorSourceRef.current);
              }}
            >
              <div
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: color }}
              />
              {label}
            </button>
          ))}
        </section>
      )}
      {plot && bounds && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {brushStart != null && brushEnd != null && (
            <div
              className="absolute"
              style={{
                left: localX(Math.min(brushStart, brushEnd)),
                top: plot.top - bounds.top,
                width: Math.abs(localX(brushEnd) - localX(brushStart)),
                height: plot.height,
                backgroundColor: BRUSH_COLOR,
                opacity: 0.15,
                border: `1px solid ${BRUSH_COLOR}`,
              }}
            />
          )}
          {crosshairX !== null && (
            <>
              <div
                className="absolute border-l border-dashed border-muted-foreground/70"
                style={{
                  left: crosshairX,
                  top: plot.top - bounds.top,
                  height: plot.height,
                }}
              />
              {hoverPoints
                .filter((point) => point.value !== null)
                .sort(
                  (a, b) =>
                    Number(nearestKeys.has(a.key)) -
                    Number(nearestKeys.has(b.key)),
                )
                .map((point) => {
                  if (point.value === null) return null;
                  const radius = nearestKeys.has(point.key)
                    ? ACTIVE_MARKER_RADIUS
                    : PLAIN_MARKER_RADIUS;
                  const y = chart?.convertToPixel(
                    { yAxisIndex: 0 },
                    point.value,
                  );
                  if (typeof y !== "number" || !Number.isFinite(y)) return null;
                  return (
                    <div
                      key={point.key}
                      className="absolute rounded-full border-2 border-card"
                      style={{
                        left: crosshairX - radius,
                        top: y - radius,
                        width: radius * 2,
                        height: radius * 2,
                        backgroundColor: point.color,
                      }}
                    />
                  );
                })}
            </>
          )}
        </div>
      )}
      {tooltipRow && tooltipState && tooltipTs !== undefined && (
        <CursorTooltip x={tooltipState.clientX} y={tooltipState.clientY}>
          <SeriesTooltipContent
            title={new Date(tooltipTs).toLocaleString()}
            rows={modelSeries
              .filter(
                ({ id }) =>
                  tooltipRow[id] != null &&
                  (activeSeries === null || id === activeSeries),
              )
              .map(({ id, label, color }) => {
                const val = tooltipRow[id];
                return {
                  key: id,
                  color,
                  label,
                  value: formatter.format(val as number),
                  // Calls out the row the pointer is on, so overlapping series
                  // can be told apart by aiming at one of them.
                  active: nearestKeys.has(id),
                };
              })}
          />
        </CursorTooltip>
      )}
    </div>
  );
}
