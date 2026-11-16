import { cn } from "@everr/ui/lib/utils";
import { chartLabel } from "@everr/ui/lib/chart-label";
import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import { SeriesTooltipContent } from "@everr/ui/components/series-tooltip";
import type { LineSeriesOption } from "echarts/charts";
import { LineChart } from "echarts/charts";
import type { GridComponentOption } from "echarts/components";
import type { ComposeOption } from "echarts/core";
import * as echarts from "echarts/core";
import { LineChart as LineChartIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { markerTolerance, nearestSeriesKeys, valueAtCursorY } from "../chart-hover";
import { nearestSampleIndex } from "../data-utils";
import {
  axisLabelsWidth,
  createTextMeasurer,
  niceValueAxis,
  timeAxisOption,
  VALUE_LABEL_OVERHANG,
  valueAxisOption,
} from "../echarts/axis";
import { type GridInsets, gridOption, plotWithin } from "../echarts/plot-rect";
import {
  SeriesLegend,
  seriesTooltipRows,
  useSeriesLegend,
} from "@everr/ui/components/series-legend";
import { useEChart } from "@everr/ui/hooks/use-echart";
import type { VisualizationProps } from "../index";
import { createValueFormatter } from "../value-format";
import { linearTimeScale, TOUCH_SCRUB, TimeTrackOverlay, useTimeTrack } from "../time-track";
import type { TimeSeriesChartSpec } from "./spec";
import { plotLines } from "./plot-lines";
import { buildChartModel, TS_KEY } from "./time-series-data";
import { PanelEmptyState } from "../panel-empty-state";

const PLAIN_MARKER_RADIUS = 4;
const ACTIVE_MARKER_RADIUS = 6;

echarts.use([LineChart]);

type ChartOption = ComposeOption<LineSeriesOption | GridComponentOption>;

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

  const domain = useMemo<[number, number]>(
    () => [timeRange.from.getTime(), timeRange.to.getTime()],
    [timeRange],
  );

  // Full resolution: hover, the tooltip and the legend read this.
  const model = useMemo(() => buildChartModel(data ?? [], domain), [data, domain]);
  const { chartData, series: modelSeries } = model;
  const { activeSeries, toggleSeries, isOnLegend, gridBottom, legend } = useSeriesLegend(
    modelSeries,
    showLegend,
  );

  // What is drawn, before the chart knows its width.
  const lines = useMemo(() => plotLines(model, stacked), [model, stacked]);
  const { scale: yAxis, format: formatAxisValue } = useMemo(
    () =>
      niceValueAxis(formatter, lines.extent[0], lines.extent[1], {
        min: typeof yAxisSpec?.min === "number" ? yAxisSpec.min : undefined,
        max: typeof yAxisSpec?.max === "number" ? yAxisSpec.max : undefined,
      }),
    [formatter, lines, yAxisSpec],
  );
  const hasChart = !!data && chartData.length > 0 && modelSeries.length > 0;

  const mounted = useEChart(chartElementRef, hasChart);
  const chart = mounted?.chart ?? null;
  const theme = mounted?.theme ?? null;

  const grid = useMemo<GridInsets | null>(() => {
    if (!theme) return null;
    const measure = createTextMeasurer(theme.fontFamily);
    return {
      left: axisLabelsWidth(yAxis.ticks.map(formatAxisValue), measure),
      right: 0,
      top: VALUE_LABEL_OVERHANG,
      bottom: gridBottom,
    };
  }, [theme, yAxis, formatAxisValue, gridBottom]);

  // The plot inside the chart element, from the size ECharts already knows:
  // reading it from the DOM here would force a layout on every pointer move.
  const plot = mounted && grid ? plotWithin(mounted, grid) : null;
  // Thinned to the plot's pixels here, so a resize draws again from the rows
  // the panel already holds: its query never sees the width.
  const plotWidth = plot?.width ?? 0;
  const pixelRatio = chart?.getDevicePixelRatio() ?? 1;
  const drawn = useMemo(() => lines.forPlot(plotWidth, pixelRatio), [lines, plotWidth, pixelRatio]);

  useEffect(() => {
    if (!mounted || !grid) return;
    const { chart, theme } = mounted;
    const series: LineSeriesOption[] = drawn.map(({ id, color, points }) => {
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
      grid: gridOption(grid),
      xAxis: timeAxisOption(theme, domain, plotWithin(mounted, grid).width),
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
    connectNulls,
    curveType,
    domain,
    drawn,
    formatAxisValue,
    grid,
    lineWidth,
    mounted,
    stacked,
    yAxis,
  ]);

  const sampleTimes = useMemo(() => chartData.map((row) => row[TS_KEY]), [chartData]);
  // Hover snaps to the nearest sample, and so does the dashboard's cursor.
  const scale = useMemo(() => linearTimeScale(domain), [domain]);
  const track = useTimeTrack({
    chartElementRef,
    size: mounted,
    grid,
    scale,
    onTimeRangeChange,
    ignore: isOnLegend,
    itemAt: (at) => {
      const index = nearestSampleIndex(sampleTimes, at.time);
      if (index === null) return null;
      return {
        index,
        timestamp: sampleTimes[index] ?? at.time,
        /** The pointer's height as a value on the y axis; null if unmeasurable. */
        cursorValue: valueAtCursorY(at.clientY, at.plot, yAxis.domain),
        /** How near `cursorValue` a series counts as pointed at, in value units. */
        tolerance: markerTolerance(at.plot.height, yAxis.domain[1] - yAxis.domain[0]),
      };
    },
    cursorTime: (sample) => sample.timestamp,
  });
  const tooltipState = track.hover && { ...track.hover.target, x: track.hover.x, y: track.hover.y };
  const { clearHover } = track;
  const onLegendToggle = useCallback(
    (identity: Parameters<typeof toggleSeries>[0]) => {
      toggleSeries(identity);
      clearHover();
    },
    [toggleSeries, clearHover],
  );

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
  const localX = (timestamp: number) =>
    plot ? plot.left + ((timestamp - domain[0]) / (domain[1] - domain[0])) * plot.width : 0;
  const markerX = tooltipTs === undefined ? null : localX(tooltipTs);

  return (
    <div
      className={cn("relative h-full w-full select-none text-muted-foreground", TOUCH_SCRUB)}
      {...track.handlers}
    >
      {/* Hover is ours: ECharts would track the pointer too, forcing a layout per move. */}
      {/* The canvas has no text of its own: say what it shows. */}
      <p className="sr-only">
        {chartLabel(
          "Time series",
          modelSeries.map(({ label }) => label),
        )}
      </p>
      <div ref={chartElementRef} aria-hidden className="pointer-events-none h-full w-full" />
      {showLegend && <SeriesLegend {...legend} onToggle={onLegendToggle} />}
      {plot && <TimeTrackOverlay scale={scale} brush={track.brush} plot={plot} />}
      {plot && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {markerX !== null &&
            hoverPoints
              .filter(
                (point): point is { key: string; value: number; color: string } =>
                  point.value !== null,
              )
              .sort((a, b) => Number(nearestKeys.has(a.key)) - Number(nearestKeys.has(b.key)))
              .map((point) => {
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
        <CursorTooltip x={tooltipState.x} y={tooltipState.y}>
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
