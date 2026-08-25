import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
} from "@everr/ui/components/chart";
import { LineChart as LineChartIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { CursorTooltip } from "@/components/cursor-tooltip";
import {
  hoverMarkers,
  markerTolerance,
  nearestSeriesKeys,
  valueAtCursorY,
} from "../chart-hover";
import {
  createTimeTickFormatter,
  generateTimeTicks,
  niceLinearDomain,
  SERIES_COLORS,
} from "../data-utils";
import type { VisualizationProps } from "../index";
import { SeriesTooltipContent } from "../series-tooltip";
import type { TimeSeriesChartSpec } from "./spec";
import { buildChartModel, buildStackedData, TS_KEY } from "./time-series-data";

const BRUSH_COLOR = SERIES_COLORS[0]!;
const MAX_X_TICKS = 6;

function getPlotArea(container: HTMLElement): DOMRect | null {
  const grid = container.querySelector(".recharts-cartesian-grid");
  return grid?.getBoundingClientRect() ?? null;
}

function pxToTimestamp(
  clientX: number,
  plotRect: DOMRect,
  domain: [number, number],
): number {
  const ratio = Math.max(
    0,
    Math.min(1, (clientX - plotRect.left) / plotRect.width),
  );
  return domain[0] + ratio * (domain[1] - domain[0]);
}

export function TimeSeriesChartVisualization({
  spec,
  data,
  timeRange,
  onTimeRangeChange,
}: VisualizationProps<TimeSeriesChartSpec>) {
  const { showLegend, connectNulls, lineWidth, unit, curveType, stacked } =
    spec;

  const containerRef = useRef<HTMLDivElement>(null);
  const plotRectRef = useRef<DOMRect | null>(null);
  const [brushStart, setBrushStart] = useState<number | null>(null);
  const [brushEnd, setBrushEnd] = useState<number | null>(null);
  const [tooltipState, setTooltipState] = useState<{
    clientX: number;
    clientY: number;
    index: number;
    /** The pointer's height as a value on the y axis; null if unmeasurable. */
    cursorValue: number | null;
    /** How near `cursorValue` a series counts as pointed at, in value units. */
    tolerance: number;
  } | null>(null);

  const domain = useMemo<[number, number]>(
    () => [timeRange.from.getTime(), timeRange.to.getTime()],
    [timeRange],
  );

  const { chartData, valueKeys, chartConfig, seriesData } = useMemo(
    () => buildChartModel(data ?? [], domain),
    [data, domain],
  );

  const stackedData = useMemo(
    () => (stacked ? buildStackedData(chartData, valueKeys) : null),
    [stacked, chartData, valueKeys],
  );

  const ticks = useMemo(() => generateTimeTicks(domain, MAX_X_TICKS), [domain]);

  // The value axis, stated rather than left to recharts, so a cursor height can
  // be read back as a value. Measured over what is actually drawn: the stacked
  // tops when stacking, otherwise each line's own samples (which can reach one
  // bucket left of the x domain).
  const yAxis = useMemo(() => {
    let lo = 0;
    let hi = 0;
    if (stackedData) {
      for (const row of stackedData) {
        let top = 0;
        for (const key of valueKeys) {
          const v = row[key];
          if (typeof v === "number") top += v;
        }
        lo = Math.min(lo, top);
        hi = Math.max(hi, top);
      }
    } else {
      for (const key of valueKeys) {
        for (const row of seriesData[key] ?? []) {
          const v = row[key];
          if (typeof v === "number") {
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        }
      }
    }
    return niceLinearDomain(lo, hi);
  }, [stackedData, seriesData, valueKeys]);

  const handleChartMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current || chartData.length === 0) return;
      const plotRect = getPlotArea(containerRef.current);
      if (!plotRect) return;
      const ts = pxToTimestamp(e.clientX, plotRect, domain);
      let nearest = 0;
      let minDist = Math.abs((chartData[0]![TS_KEY] as number) - ts);
      for (let i = 1; i < chartData.length; i++) {
        const dist = Math.abs((chartData[i]![TS_KEY] as number) - ts);
        if (dist < minDist) {
          minDist = dist;
          nearest = i;
        }
      }
      setTooltipState({
        clientX: e.clientX,
        clientY: e.clientY,
        index: nearest,
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
    [domain, chartData, yAxis],
  );

  const handleChartMouseLeave = useCallback(() => {
    setTooltipState(null);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!containerRef.current) return;
      const plotRect = getPlotArea(containerRef.current);
      if (!plotRect) return;
      plotRectRef.current = plotRect;
      const ts = pxToTimestamp(e.clientX, plotRect, domain);
      setBrushStart(ts);
      setBrushEnd(null);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [domain],
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
        onTimeRangeChange({ from: new Date(from), to: new Date(to) });
      }
    }
    setBrushStart(null);
    setBrushEnd(null);
    plotRectRef.current = null;
  }, [brushStart, brushEnd, onTimeRangeChange]);

  // `valueKeys.length === 0` means rows came back but none had a numeric column
  // to plot — buildChartModel still emits timestamp-only entries, so guard on it
  // explicitly instead of letting an axis-only, line-less chart render.
  if (!data || chartData.length === 0 || valueKeys.length === 0) {
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

  const tooltipRow = tooltipState ? chartData[tooltipState.index] : undefined;
  const tooltipTs = tooltipRow ? (tooltipRow[TS_KEY] as number) : undefined;

  // Where each series is drawn at the hovered instant. Stacked series sit at
  // their cumulative top (the running sum in render order), which is where the
  // band edge is, not at the raw value.
  let stackTop = 0;
  const hoverPoints = valueKeys.map((key) => {
    const val = tooltipRow?.[key];
    stackTop += typeof val === "number" ? val : 0;
    return {
      key,
      value:
        typeof val !== "number" ? null : stacked ? stackTop : (val as number),
      color: chartConfig[key]?.color,
    };
  });

  // Which of them the pointer is actually on. Several series can share a value
  // (two at zero is routine), so this names every one of them.
  const nearestKeys = nearestSeriesKeys(
    hoverPoints,
    tooltipState?.cursorValue ?? null,
    tooltipState?.tolerance ?? 0,
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: chart interaction area
    <div
      ref={containerRef}
      className="relative h-full w-full select-none"
      onMouseMove={handleChartMouseMove}
      onMouseLeave={handleChartMouseLeave}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <ChartContainer config={chartConfig} className="h-full w-full">
        <ComposedChart
          data={stackedData ?? chartData}
          margin={{ left: 12, right: 12, top: 8 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey={TS_KEY}
            type="number"
            domain={domain}
            ticks={ticks}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={createTimeTickFormatter(domain)}
            // Hard domain: the leading bucket kept by buildSeriesData sits
            // before `from` — clip its line at the plot edge instead of letting
            // recharts stretch the axis to fit it (which would also skew the
            // linear px↔ts mapping the brush and crosshair rely on).
            allowDataOverflow
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            // Declared, not inferred: the hover highlight has to map a cursor
            // height back to a value, and recharts does not expose the axis it
            // would have chosen.
            domain={yAxis.domain}
            ticks={yAxis.ticks}
            tickFormatter={(v) => (unit ? `${v}${unit}` : String(v))}
          />
          {showLegend && <ChartLegend content={<ChartLegendContent />} />}
          {valueKeys.map((key) =>
            stacked ? (
              // Stacked areas must all read from the chart-level data (the
              // zero-filled merged timeline) — recharts accumulates stackId
              // offsets across that shared array, not across per-series ones.
              <Area
                key={key}
                stackId="stack"
                dataKey={key}
                type={curveType}
                stroke={`var(--color-${key})`}
                fill={`var(--color-${key})`}
                fillOpacity={0.4}
                strokeWidth={lineWidth}
                dot={false}
                isAnimationActive={false}
              />
            ) : (
              <Line
                key={key}
                // Each line renders from its own data so it connects its own
                // points regardless of where other series have samples.
                data={seriesData[key]}
                dataKey={key}
                type={curveType}
                stroke={`var(--color-${key})`}
                strokeWidth={lineWidth}
                dot={false}
                connectNulls={connectNulls}
                isAnimationActive={false}
              />
            ),
          )}
          {tooltipTs !== undefined && (
            <ReferenceLine
              x={tooltipTs}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
          )}
          {tooltipTs !== undefined &&
            hoverMarkers({
              x: tooltipTs,
              points: hoverPoints,
              activeKeys: nearestKeys,
            })}
          {brushStart != null && brushEnd != null && (
            <ReferenceArea
              x1={brushStart}
              x2={brushEnd}
              fill={BRUSH_COLOR}
              fillOpacity={0.15}
              stroke={BRUSH_COLOR}
              strokeOpacity={0.3}
            />
          )}
        </ComposedChart>
      </ChartContainer>
      {tooltipRow && (
        <CursorTooltip x={tooltipState!.clientX} y={tooltipState!.clientY}>
          <SeriesTooltipContent
            title={new Date(tooltipTs!).toLocaleString()}
            rows={valueKeys
              .filter((key) => tooltipRow[key] != null)
              .map((key) => {
                const val = tooltipRow[key];
                return {
                  key,
                  color: chartConfig[key]?.color,
                  label: chartConfig[key]?.label ?? key,
                  value: unit ? `${val}${unit}` : String(val),
                  // Calls out the row the pointer is on, so overlapping series
                  // can be told apart by aiming at one of them.
                  active: nearestKeys.has(key),
                };
              })}
          />
        </CursorTooltip>
      )}
    </div>
  );
}
