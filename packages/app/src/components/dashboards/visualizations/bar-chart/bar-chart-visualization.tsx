import { ChartContainer, ChartLegend, ChartLegendContent } from "@everr/ui/components/chart";
import { BarChart3 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Text, XAxis, YAxis } from "recharts";
import { CursorTooltip } from "@/components/cursor-tooltip";
import type { VisualizationProps } from "../index";
import { SeriesTooltipContent } from "../series-tooltip";
import { buildBarChartModel, X_KEY } from "./bar-chart-data";
import type { BarChartSpec } from "./spec";

const MAX_CATEGORY_TICKS = 8;
const TICK_FONT_SIZE = 12;
// Rough advance width of a glyph at TICK_FONT_SIZE for the default UI font.
// Only used to estimate how many characters fit in a tick's band.
const TICK_CHAR_PX = TICK_FONT_SIZE * 0.55;

// Middle ellipsis: keeps both the head and tail of a label. Path-like
// categories (e.g. "/[locale]/company/[companyUID]/people") share a long
// common prefix and differ at the end, so plain end-truncation would collapse
// them all to the same string — keeping both ends preserves what distinguishes
// them.
function truncateMiddle(text: string, maxChars: number): string {
  if (maxChars < 1) return "";
  if (text.length <= maxChars) return text;
  if (maxChars === 1) return "…";
  const keep = maxChars - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return tail > 0
    ? `${text.slice(0, head)}…${text.slice(text.length - tail)}`
    : `${text.slice(0, head)}…`;
}

// Tick renderer for the (string) category axis. recharts passes the axis's
// plotting `width`/`height` plus `visibleTicksCount`, which lets us size each
// label to the pixel band it actually owns and truncate to fit instead of
// letting long labels collide. The full value stays available on hover via
// <title> (and in the bar tooltip).
function CategoryTick({
  axis,
  formatter,
  ...props
}: {
  axis: "x" | "y";
  formatter: (value: string | number) => string;
  // recharts injects these on the cloned tick element.
  x?: number;
  y?: number;
  width?: number;
  visibleTicksCount?: number;
  payload?: { value: string | number };
}) {
  const { x = 0, y = 0, width = 0, payload } = props;
  const label = formatter(payload?.value ?? "");
  const visible = props.visibleTicksCount || 1;
  // x-axis: each label owns one horizontal band; y-axis: the whole axis width.
  const availablePx = axis === "x" ? width / visible : width;
  const maxChars = Math.max(1, Math.floor((availablePx - 8) / TICK_CHAR_PX));
  const display = truncateMiddle(label, maxChars);
  return (
    <g>
      {display !== label && <title>{label}</title>}
      <Text
        x={x}
        y={y}
        textAnchor={axis === "x" ? "middle" : "end"}
        verticalAnchor={axis === "x" ? "start" : "middle"}
        fontSize={TICK_FONT_SIZE}
        className="fill-muted-foreground"
      >
        {display}
      </Text>
    </g>
  );
}

function getPlotArea(container: HTMLElement): DOMRect | null {
  const grid = container.querySelector(".recharts-cartesian-grid");
  return grid?.getBoundingClientRect() ?? null;
}

function createTimeTickFormatter(spanMs: number) {
  return (x: string | number) => {
    const d = new Date(Number(x));
    if (spanMs > 86_400_000) {
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

export function BarChartVisualization({ spec, data }: VisualizationProps<BarChartSpec>) {
  const { unit, showLegend, stacking, orientation, showValues } = spec;

  const { chartData, valueKeys, chartConfig, isTimeAxis } = useMemo(
    () => buildBarChartModel(data ?? []),
    [data],
  );

  // recharts naming: layout "vertical" = horizontal bars.
  const horizontal = orientation === "horizontal";

  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltipState, setTooltipState] = useState<{
    clientX: number;
    clientY: number;
    index: number;
  } | null>(null);

  // Mirror the other visualizations' cursor-following tooltip instead of
  // recharts' built-in one: map the pointer to the nearest category band and
  // drive a portaled CursorTooltip from it.
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const el = containerRef.current;
      if (!el || chartData.length === 0) return;
      const rect = getPlotArea(el);
      if (!rect) return;
      const ratio = horizontal
        ? (e.clientY - rect.top) / rect.height
        : (e.clientX - rect.left) / rect.width;
      const index = Math.min(
        chartData.length - 1,
        Math.max(0, Math.floor(ratio * chartData.length)),
      );
      setTooltipState({ clientX: e.clientX, clientY: e.clientY, index });
    },
    [chartData, horizontal],
  );

  const handleMouseLeave = useCallback(() => setTooltipState(null), []);

  // `valueKeys.length === 0` means rows came back but none had a numeric
  // column to plot — guard on it explicitly instead of rendering an axis-only,
  // bar-less chart.
  if (!data || chartData.length === 0 || valueKeys.length === 0) {
    const message = !data
      ? "Configure a query to see results"
      : chartData.length === 0
        ? "No data in this time range"
        : "No numeric data to plot";
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <BarChart3 className="size-8" />
        <p className="text-sm">{message}</p>
      </div>
    );
  }

  const stacked = stacking !== "none";

  const first = chartData[0];
  const last = chartData.at(-1);
  const spanMs =
    isTimeAxis && first && last && chartData.length > 1
      ? (last[X_KEY] as number) - (first[X_KEY] as number)
      : 0;
  const formatXTick = isTimeAxis
    ? createTimeTickFormatter(spanMs)
    : (x: string | number) => String(x);
  // With percent stacking the value axis runs 0..1 (stackOffset="expand").
  const formatValueTick = (v: number) =>
    stacking === "percent" ? `${Math.round(v * 100)}%` : unit ? `${v}${unit}` : String(v);
  const formatValue = (v: number) => (unit ? `${v.toLocaleString()}${unit}` : v.toLocaleString());

  // Dense (time-bucketed) data produces one category per bucket — thin the
  // tick labels instead of letting them overlap.
  const tickInterval = Math.max(0, Math.ceil(chartData.length / MAX_CATEGORY_TICKS) - 1);

  const categoryAxisProps = {
    dataKey: X_KEY,
    type: "category" as const,
    interval: tickInterval,
    // Custom tick truncates long category labels to their available band so
    // they stop overlapping; it receives the raw value, so format here.
    tick: (tickProps: object) => (
      <CategoryTick axis={horizontal ? "y" : "x"} formatter={formatXTick} {...tickProps} />
    ),
  };
  const valueAxisProps = {
    type: "number" as const,
    tickFormatter: formatValueTick,
  };

  const tooltipRow = tooltipState ? chartData[tooltipState.index] : undefined;
  const tooltipX = tooltipRow ? tooltipRow[X_KEY] : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: chart interaction area
    <div
      ref={containerRef}
      className="relative h-full w-full"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <ChartContainer config={chartConfig} className="h-full w-full" debounce={100}>
        <BarChart
          data={chartData}
          // recharts naming: layout "vertical" = horizontal bars.
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ left: 12, right: 12, top: 8 }}
          stackOffset={stacking === "percent" ? "expand" : undefined}
        >
          <CartesianGrid horizontal={!horizontal} vertical={horizontal} />
          <XAxis
            {...(horizontal ? valueAxisProps : categoryAxisProps)}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis
            {...(horizontal ? categoryAxisProps : valueAxisProps)}
            width={horizontal ? 90 : 60}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          {showLegend && <ChartLegend content={<ChartLegendContent />} />}
          {valueKeys.map((key) => (
            <Bar
              key={key}
              dataKey={key}
              stackId={stacked ? "stack" : undefined}
              fill={`var(--color-${key})`}
              maxBarSize={64}
              isAnimationActive={false}
            >
              {showValues && (
                <LabelList
                  dataKey={key}
                  position={stacked ? "center" : horizontal ? "right" : "top"}
                  className="fill-foreground"
                  fontSize={10}
                  formatter={(v: unknown) => (typeof v === "number" ? formatValue(v) : "")}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
      {tooltipState && tooltipRow && (
        <CursorTooltip x={tooltipState.clientX} y={tooltipState.clientY}>
          <SeriesTooltipContent
            title={isTimeAxis ? new Date(Number(tooltipX)).toLocaleString() : String(tooltipX)}
            rows={valueKeys
              .filter((key) => typeof tooltipRow[key] === "number")
              .map((key) => ({
                key,
                color: chartConfig[key]?.color,
                label: chartConfig[key]?.label ?? key,
                value: formatValue(tooltipRow[key] as number),
              }))}
          />
        </CursorTooltip>
      )}
    </div>
  );
}
