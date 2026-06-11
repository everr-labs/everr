import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
} from "@everr/ui/components/chart";
import { LineChart as LineChartIcon } from "lucide-react";
import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { CursorTooltip } from "@/components/cursor-tooltip";
import { SERIES_COLORS } from "../data-utils";
import type { VisualizationProps } from "../index";
import type { TimeSeriesChartSpec } from "./spec";
import { buildChartModel, TS_KEY } from "./time-series-data";

const BRUSH_COLOR = SERIES_COLORS[0]!;
const MAX_X_TICKS = 6;

function createTickFormatter(domain: [number, number]) {
  const span = domain[1] - domain[0];
  return (ms: number) => {
    const d = new Date(ms);
    if (span > 86_400_000) {
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    }
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  };
}

const TICK_INTERVALS = [
  1_000,
  5_000,
  10_000,
  30_000,
  60_000,
  5 * 60_000,
  10 * 60_000,
  30 * 60_000,
  3_600_000,
  3 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
  86_400_000,
  2 * 86_400_000,
  3 * 86_400_000,
  7 * 86_400_000,
  14 * 86_400_000,
  30 * 86_400_000,
  90 * 86_400_000,
  365 * 86_400_000,
];

function generateTicks(domain: [number, number], maxTicks: number): number[] {
  const span = domain[1] - domain[0];
  if (span <= 0) return [];

  const ideal = span / maxTicks;
  const interval =
    TICK_INTERVALS.find((i) => i >= ideal) ?? TICK_INTERVALS.at(-1)!;

  const first = Math.ceil(domain[0] / interval) * interval;
  const ticks: number[] = [];
  for (let t = first; t <= domain[1]; t += interval) {
    ticks.push(t);
  }
  return ticks;
}

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
  const { showLegend, connectNulls, lineWidth, unit, curveType } = spec;

  const containerRef = useRef<HTMLDivElement>(null);
  const plotRectRef = useRef<DOMRect | null>(null);
  const [brushStart, setBrushStart] = useState<number | null>(null);
  const [brushEnd, setBrushEnd] = useState<number | null>(null);
  const [tooltipState, setTooltipState] = useState<{
    clientX: number;
    clientY: number;
    index: number;
  } | null>(null);

  const domain = useMemo<[number, number]>(
    () => [timeRange.from.getTime(), timeRange.to.getTime()],
    [timeRange],
  );

  const { chartData, valueKeys, chartConfig, seriesData } = useMemo(
    () => buildChartModel(data ?? [], domain),
    [data, domain],
  );

  const ticks = useMemo(() => generateTicks(domain, MAX_X_TICKS), [domain]);

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
      });
    },
    [domain, chartData],
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
      <ChartContainer
        config={chartConfig}
        className="h-full w-full"
        debounce={100}
      >
        <LineChart data={chartData} margin={{ left: 12, right: 12, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey={TS_KEY}
            type="number"
            domain={domain}
            ticks={ticks}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={createTickFormatter(domain)}
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
            tickFormatter={(v) => (unit ? `${v}${unit}` : String(v))}
          />
          {showLegend && <ChartLegend content={<ChartLegendContent />} />}
          {valueKeys.map((key) => (
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
          ))}
          {tooltipTs !== undefined && (
            <ReferenceLine
              x={tooltipTs}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
          )}
          {tooltipTs !== undefined &&
            valueKeys.map((key) => {
              const val = tooltipRow?.[key];
              if (typeof val !== "number") return null;
              return (
                <ReferenceDot
                  key={key}
                  x={tooltipTs}
                  y={val}
                  r={4}
                  fill={chartConfig[key]?.color}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              );
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
        </LineChart>
      </ChartContainer>
      {tooltipRow && (
        <CursorTooltip x={tooltipState!.clientX} y={tooltipState!.clientY}>
          <div className="mb-1 text-muted-foreground">
            {new Date(tooltipTs!).toLocaleString()}
          </div>
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5">
            {valueKeys.map((key) => {
              const val = tooltipRow[key];
              if (val == null) return null;
              return (
                <Fragment key={key}>
                  <span
                    className="inline-block size-2.5 rounded-full"
                    style={{ backgroundColor: chartConfig[key]?.color }}
                  />
                  <span className="text-muted-foreground">
                    {chartConfig[key]?.label ?? key}
                  </span>
                  <span className="text-right font-medium tabular-nums">
                    {unit ? `${val}${unit}` : String(val)}
                  </span>
                </Fragment>
              );
            })}
          </div>
        </CursorTooltip>
      )}
    </div>
  );
}
