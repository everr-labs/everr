import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
} from "@everr/ui/components/chart";
import { LineChart as LineChartIcon } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  CartesianGrid,
  Customized,
  Line,
  LineChart,
  ReferenceArea,
  XAxis,
  YAxis,
} from "recharts";
import type { VisualizationProps } from "../index";
import { buildChartModel, TS_KEY } from "./time-series-data";

type CurveType = "monotone" | "linear" | "natural" | "stepBefore" | "stepAfter";

function createTickFormatter(domain?: [number, number]) {
  const span = domain ? domain[1] - domain[0] : 0;
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
  plugin,
  data,
  timeRange,
  onTimeRangeChange,
}: VisualizationProps) {
  const showLegend = plugin.spec.showLegend === true;
  const connectNulls = plugin.spec.connectNulls === true;
  const lineWidth =
    typeof plugin.spec.lineWidth === "number" ? plugin.spec.lineWidth : 1.5;
  const unit = typeof plugin.spec.unit === "string" ? plugin.spec.unit : "";
  const curveType: CurveType =
    typeof plugin.spec.curveType === "string"
      ? (plugin.spec.curveType as CurveType)
      : "monotone";

  const containerRef = useRef<HTMLDivElement>(null);
  const plotRectRef = useRef<DOMRect | null>(null);
  const [maxTicks, setMaxTicks] = useState(6);
  const [brushStart, setBrushStart] = useState<number | null>(null);
  const [brushEnd, setBrushEnd] = useState<number | null>(null);
  const [tooltipState, setTooltipState] = useState<{
    clientX: number;
    clientY: number;
    index: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const computeTicks = (width: number) =>
      Math.max(2, Math.floor(width / 120));
    setMaxTicks(computeTicks(el.clientWidth));
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = computeTicks(entry.contentRect.width);
      setMaxTicks((prev) => (prev === next ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const domain: [number, number] | undefined = useMemo(
    () =>
      timeRange
        ? [timeRange.from.getTime(), timeRange.to.getTime()]
        : undefined,
    [timeRange],
  );

  const { chartData, valueKeys, chartConfig, seriesData } = useMemo(
    () => buildChartModel(data ?? [], domain),
    [data, domain],
  );

  const ticks = useMemo(
    () => (domain ? generateTicks(domain, maxTicks) : undefined),
    [domain, maxTicks],
  );

  const handleChartMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current || !domain || chartData.length === 0) return;
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
      if (!containerRef.current || !domain) return;
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
      if (brushStart == null || !plotRectRef.current || !domain) return;
      const ts = pxToTimestamp(e.clientX, plotRectRef.current, domain);
      setBrushEnd(ts);
    },
    [brushStart, domain],
  );

  const handlePointerUp = useCallback(() => {
    if (brushStart != null && brushEnd != null && onTimeRangeChange) {
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

  if (!data || chartData.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <LineChartIcon className="size-8" />
        <p className="text-sm">
          {!data
            ? "Configure a query to see results"
            : "No data in this time range"}
        </p>
      </div>
    );
  }

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
            domain={domain ?? ["dataMin", "dataMax"]}
            ticks={ticks}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={createTickFormatter(domain)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(v) => (unit ? `${v}${unit}` : String(v))}
          />
          <Customized
            component={(props: Record<string, unknown>) => {
              if (!tooltipState) return null;
              const row = chartData[tooltipState.index];
              if (!row) return null;
              const xMap = props.xAxisMap as
                | Record<string, { scale: (v: number) => number }>
                | undefined;
              const yMap = props.yAxisMap as
                | Record<string, { scale: (v: number) => number }>
                | undefined;
              const xScale = xMap ? Object.values(xMap)[0]?.scale : undefined;
              const yScale = yMap ? Object.values(yMap)[0]?.scale : undefined;
              if (!xScale || !yScale) return null;
              const cx = xScale(row[TS_KEY] as number);
              const offset = props.offset as
                | { top?: number; height?: number }
                | undefined;
              const top = offset?.top ?? 0;
              const height = offset?.height ?? 0;
              return (
                <g>
                  <line
                    x1={cx}
                    x2={cx}
                    y1={top}
                    y2={top + height}
                    stroke="var(--border)"
                    strokeDasharray="3 3"
                  />
                  {valueKeys.map((key) => {
                    const val = row[key];
                    if (val == null || typeof val !== "number") return null;
                    return (
                      <circle
                        key={key}
                        cx={cx}
                        cy={yScale(val)}
                        r={4}
                        fill={chartConfig[key]?.color}
                        stroke="var(--card)"
                        strokeWidth={2}
                      />
                    );
                  })}
                </g>
              );
            }}
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
          {brushStart != null && brushEnd != null && (
            <ReferenceArea
              x1={brushStart}
              x2={brushEnd}
              fill="hsl(217, 91%, 60%)"
              fillOpacity={0.15}
              stroke="hsl(217, 91%, 60%)"
              strokeOpacity={0.3}
            />
          )}
        </LineChart>
      </ChartContainer>
      {tooltipState &&
        chartData[tooltipState.index] &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md"
            style={{
              left: tooltipState.clientX + 12,
              top: tooltipState.clientY + 12,
            }}
          >
            <div className="mb-1 text-muted-foreground">
              {new Date(
                chartData[tooltipState.index]![TS_KEY] as number,
              ).toLocaleString()}
            </div>
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5">
              {valueKeys.map((key) => {
                const val = chartData[tooltipState.index]![key];
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
          </div>,
          document.body,
        )}
    </div>
  );
}
