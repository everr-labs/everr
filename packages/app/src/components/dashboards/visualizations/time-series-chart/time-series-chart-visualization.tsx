import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import { SeriesTooltipContent } from "@everr/ui/components/series-tooltip";
import type { LineSeriesOption } from "echarts/charts";
import { LineChart } from "echarts/charts";
import type { GridComponentOption } from "echarts/components";
import type { ComposeOption } from "echarts/core";
import * as echarts from "echarts/core";
import { LineChart as LineChartIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markerTolerance, nearestSeriesKeys, valueAtCursorY } from "../chart-hover";
import { SERIES_COLORS } from "../data-utils";
import {
  axisLabelsWidth,
  createTextMeasurer,
  niceValueAxis,
  timeAxisOption,
  valueAxisOption,
} from "../echarts/axis";
import {
  type GridInsets,
  getPlotRect,
  type PlotRect,
  plotWithin,
  ratioWithin,
} from "../echarts/plot-rect";
import {
  SeriesLegend,
  seriesTooltipRows,
  useSeriesLegend,
} from "@everr/ui/components/series-legend";
import { useEChart } from "@everr/ui/hooks/use-echart";
import type { VisualizationProps } from "../index";
import { createValueFormatter } from "../value-format";
import { CursorLine } from "@everr/ui/components/cursor-line";
import { usePointTimeCursor, useTimeCursor } from "../shared-time-cursor";
import type { TimeSeriesChartSpec } from "./spec";
import { buildChartModel, buildStackedData, TS_KEY } from "./time-series-data";
import { PanelEmptyState } from "../panel-empty-state";

const BRUSH_COLOR = SERIES_COLORS[0] ?? "hsl(263, 90%, 65%)";
const PLAIN_MARKER_RADIUS = 4;
const ACTIVE_MARKER_RADIUS = 6;

echarts.use([LineChart]);

type ChartOption = ComposeOption<LineSeriesOption | GridComponentOption>;

function pxToTimestamp(clientX: number, plotRect: PlotRect, domain: [number, number]): number {
  return domain[0] + ratioWithin(clientX, plotRect.left, plotRect.width) * (domain[1] - domain[0]);
}

/**
 * The dashboard's shared cursor across the plot. It reads the cursor itself,
 * so a hover in another panel redraws this line and not the chart.
 */
function SeriesCursor({ plot, domain }: { plot: PlotRect; domain: [number, number] }) {
  const cursor = useTimeCursor();
  if (cursor === null || cursor < domain[0] || cursor > domain[1]) return null;
  const left = plot.left + ((cursor - domain[0]) / (domain[1] - domain[0])) * plot.width;
  return <CursorLine style={{ left, top: plot.top, height: plot.height }} />;
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
    case "linear":
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
  const formatter = useMemo(() => createValueFormatter(spec.valueFormat), [spec.valueFormat]);
  const { showLegend, connectNulls, lineWidth, curveType, stacked, yAxis: yAxisSpec } = spec;

  const chartElementRef = useRef<HTMLDivElement>(null);
  const { set: setCursor, clear: clearCursor } = usePointTimeCursor();
  const plotRectRef = useRef<PlotRect | null>(null);
  const [brushStart, setBrushStart] = useState<number | null>(null);
  const [brushEnd, setBrushEnd] = useState<number | null>(null);
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
  const { activeSeries, toggleSeries, isOnLegend, gridBottom, legend } = useSeriesLegend(
    modelSeries,
    showLegend,
  );

  const stackedData = useMemo(
    () => (stacked ? buildStackedData(chartData, modelSeries) : null),
    [stacked, chartData, modelSeries],
  );

  // Measure over what is actually drawn: the stacked
  // tops when stacking, otherwise each line's own samples (which can reach one
  // bucket left of the x domain).
  const { scale: yAxis, format: formatAxisValue } = useMemo(() => {
    let lo = stackedData ? 0 : Number.POSITIVE_INFINITY;
    let hi = stackedData ? 0 : Number.NEGATIVE_INFINITY;
    if (stackedData) {
      for (let i = 0; i < chartData.length; i++) {
        let top = 0;
        for (const points of stackedData) {
          const v = points[i]?.[1];
          if (typeof v === "number") top += v;
          lo = Math.min(lo, top);
          hi = Math.max(hi, top);
        }
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
    return niceValueAxis(formatter, lo, hi, {
      min: typeof yAxisSpec?.min === "number" ? yAxisSpec.min : undefined,
      max: typeof yAxisSpec?.max === "number" ? yAxisSpec.max : undefined,
    });
  }, [chartData.length, formatter, stackedData, modelSeries, yAxisSpec]);
  const hasChart = !!data && chartData.length > 0 && modelSeries.length > 0;

  const clearTooltip = useCallback(() => setTooltipState(null), []);
  const mounted = useEChart(chartElementRef, hasChart, clearTooltip);
  const chart = mounted?.chart ?? null;
  const theme = mounted?.theme ?? null;

  const grid = useMemo<GridInsets | null>(() => {
    if (!theme) return null;
    const measure = createTextMeasurer(theme.fontFamily);
    return {
      left: axisLabelsWidth(yAxis.ticks.map(formatAxisValue), measure),
      right: 0,
      top: 0,
      bottom: gridBottom,
    };
  }, [theme, yAxis, formatAxisValue, gridBottom]);

  useEffect(() => {
    if (!chart || !theme || !grid) return;
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
        stackStrategy: "all",
        areaStyle: stacked ? { color, opacity: dimmed ? 0.06 : 0.4 } : undefined,
        lineStyle: { color, width: lineWidth, opacity: dimmed ? 0.15 : 1 },
        itemStyle: { color },
        ...curveOptions(curveType),
      };
    });
    const option: ChartOption = {
      animation: false,
      grid,
      xAxis: timeAxisOption(theme, domain),
      yAxis: valueAxisOption({
        theme,
        scale: yAxis,
        format: formatAxisValue,
      }),
      series,
    };
    chart.setOption(option, { notMerge: true });
  }, [
    activeSeries,
    chart,
    connectNulls,
    curveType,
    domain,
    formatAxisValue,
    grid,
    lineWidth,
    modelSeries,
    stacked,
    stackedData,
    theme,
    yAxis,
  ]);

  const handleChartMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isOnLegend(e.target)) {
        setTooltipState(null);
        clearCursor();
        return;
      }
      const element = chartElementRef.current;
      if (!element || !grid || chartData.length === 0) return;
      const plotRect = getPlotRect(element, grid);
      if (!plotRect) return;
      const ts = pxToTimestamp(e.clientX, plotRect, domain);
      const first = chartData[0];
      if (!first) return;
      let nearest = 0;
      let minDist = Math.abs(first[TS_KEY] - ts);
      for (let i = 1; i < chartData.length; i++) {
        const row = chartData[i];
        if (!row) continue;
        const dist = Math.abs(row[TS_KEY] - ts);
        if (dist < minDist) {
          minDist = dist;
          nearest = i;
        }
      }
      const hoveredRow = chartData[nearest];
      if (!hoveredRow) return;
      setCursor(hoveredRow[TS_KEY]);
      setTooltipState({
        clientX: e.clientX,
        clientY: e.clientY,
        index: nearest,
        timestamp: hoveredRow[TS_KEY],
        cursorValue: valueAtCursorY(
          e.clientY,
          { top: plotRect.top, height: plotRect.height },
          yAxis.domain,
        ),
        tolerance: markerTolerance(plotRect.height, yAxis.domain[1] - yAxis.domain[0]),
      });
    },
    [domain, chartData, setCursor, clearCursor, grid, isOnLegend, yAxis],
  );

  const handleChartMouseLeave = useCallback(() => {
    setTooltipState(null);
    clearCursor();
  }, [clearCursor]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isOnLegend(e.target)) return;
      const element = chartElementRef.current;
      if (!element || !grid) return;
      const plotRect = getPlotRect(element, grid);
      if (!plotRect) return;
      plotRectRef.current = plotRect;
      const ts = pxToTimestamp(e.clientX, plotRect, domain);
      setBrushStart(ts);
      setBrushEnd(null);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [domain, grid, isOnLegend],
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
    return (
      <PanelEmptyState
        icon={LineChartIcon}
        data={data}
        unusable="No row has a time inside this time range and a numeric value."
      />
    );
  }

  const hoveredRow = tooltipState ? chartData[tooltipState.index] : undefined;
  const tooltipRow = hoveredRow?.[TS_KEY] === tooltipState?.timestamp ? hoveredRow : undefined;
  const tooltipTs = tooltipRow?.[TS_KEY];

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
        value: typeof val !== "number" ? null : stacked ? stackTop : val,
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
  // The plot inside the chart element, from the size ECharts already knows:
  // reading it from the DOM here would force a layout on every pointer move.
  const plot = chart && grid ? plotWithin(chart, grid) : null;
  const localX = (timestamp: number) =>
    plot ? plot.left + ((timestamp - domain[0]) / (domain[1] - domain[0])) * plot.width : 0;
  const markerX = tooltipTs === undefined ? null : localX(tooltipTs);

  return (
    <div
      className="relative h-full w-full select-none text-muted-foreground"
      onMouseMove={handleChartMouseMove}
      onMouseLeave={handleChartMouseLeave}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* Hover is ours: ECharts would track the pointer too, forcing a layout per move. */}
      <div ref={chartElementRef} className="pointer-events-none h-full w-full" />
      {showLegend && (
        <SeriesLegend
          {...legend}
          onToggle={(identity) => {
            toggleSeries(identity);
            setTooltipState(null);
            clearCursor();
          }}
        />
      )}
      {plot && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {brushStart != null && brushEnd != null && (
            <div
              className="absolute"
              style={{
                left: localX(Math.min(brushStart, brushEnd)),
                top: plot.top,
                width: Math.abs(localX(brushEnd) - localX(brushStart)),
                height: plot.height,
                backgroundColor: BRUSH_COLOR,
                opacity: 0.15,
                border: `1px solid ${BRUSH_COLOR}`,
              }}
            />
          )}
          <SeriesCursor plot={plot} domain={domain} />
          {markerX !== null &&
            hoverPoints
              .filter((point) => point.value !== null)
              .sort((a, b) => Number(nearestKeys.has(a.key)) - Number(nearestKeys.has(b.key)))
              .map((point) => {
                if (point.value === null) return null;
                const radius = nearestKeys.has(point.key)
                  ? ACTIVE_MARKER_RADIUS
                  : PLAIN_MARKER_RADIUS;
                const y = chart?.convertToPixel({ yAxisIndex: 0 }, point.value);
                if (typeof y !== "number" || !Number.isFinite(y)) return null;
                return (
                  <div
                    key={point.key}
                    className="absolute rounded-full border-2 border-card"
                    style={{
                      left: markerX - radius,
                      top: y - radius,
                      width: radius * 2,
                      height: radius * 2,
                      backgroundColor: point.color,
                    }}
                  />
                );
              })}
        </div>
      )}
      {tooltipRow && tooltipState && tooltipTs !== undefined && (
        <CursorTooltip x={tooltipState.clientX} y={tooltipState.clientY}>
          <SeriesTooltipContent
            title={new Date(tooltipTs).toLocaleString()}
            // `nearestKeys` calls out the row the pointer is on, so overlapping
            // series can be told apart by aiming at one of them.
            rows={seriesTooltipRows(
              modelSeries,
              tooltipRow,
              activeSeries,
              formatter.format,
              nearestKeys,
            )}
          />
        </CursorTooltip>
      )}
    </div>
  );
}
