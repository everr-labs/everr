import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@everr/ui/components/chart";
import { LineChart as LineChartIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  XAxis,
  YAxis,
} from "recharts";
import type { QueryResultRow, VisualizationProps } from "../index";
import type { CurveType } from "./time-series-chart-settings";

const COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(142, 71%, 45%)",
  "hsl(0, 84%, 60%)",
  "hsl(280, 68%, 60%)",
  "hsl(35, 92%, 50%)",
  "hsl(190, 90%, 50%)",
];

const TS_KEY = "__ts";

function detectTimeKey(rows: QueryResultRow[]): string | undefined {
  const first = rows[0];
  if (!first) return undefined;

  const timePatterns =
    /^(time|timestamp|date|datetime|created_at|ts|period|bucket|interval)/i;
  for (const key of Object.keys(first)) {
    if (timePatterns.test(key)) return key;
  }
  return undefined;
}

function getValueKeys(row: QueryResultRow, timeKey: string): string[] {
  return Object.keys(row).filter(
    (k) => k !== timeKey && typeof row[k] === "number",
  );
}

function toTimestamp(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const ms = new Date(`${value.replace(" ", "T")}Z`).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

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

function formatTooltipLabel(
  _label: unknown,
  payload: Array<{ payload?: Record<string, unknown> }>,
): string {
  const ts = payload[0]?.payload?.[TS_KEY];
  if (typeof ts === "number") return new Date(ts).toLocaleString();
  return String(_label);
}

const TICK_INTERVALS = [
  1_000, // 1s
  5_000, // 5s
  10_000, // 10s
  30_000, // 30s
  60_000, // 1m
  5 * 60_000, // 5m
  10 * 60_000, // 10m
  30 * 60_000, // 30m
  3_600_000, // 1h
  3 * 3_600_000, // 3h
  6 * 3_600_000, // 6h
  12 * 3_600_000, // 12h
  86_400_000, // 1d
  2 * 86_400_000, // 2d
  3 * 86_400_000, // 3d
  7 * 86_400_000, // 1w
  14 * 86_400_000, // 2w
  30 * 86_400_000, // 1mo
  90 * 86_400_000, // 3mo
  365 * 86_400_000, // 1y
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

  const { chartData, valueKeys, chartConfig, domain, ticks } = useMemo(() => {
    const dm: [number, number] | undefined = timeRange
      ? [timeRange.from.getTime(), timeRange.to.getTime()]
      : undefined;

    if (!data || data.length === 0) {
      return {
        chartData: [],
        valueKeys: [],
        chartConfig: {},
        domain: dm,
        ticks: dm ? generateTicks(dm, maxTicks) : undefined,
      };
    }

    const tk = detectTimeKey(data);
    if (!tk) {
      return {
        chartData: [],
        valueKeys: [],
        chartConfig: {},
        domain: dm,
        ticks: dm ? generateTicks(dm, maxTicks) : undefined,
      };
    }

    const vk = getValueKeys(data[0]!, tk);
    const config: ChartConfig = {};
    for (let i = 0; i < vk.length; i++) {
      config[vk[i]!] = {
        label: vk[i],
        color: COLORS[i % COLORS.length],
      };
    }

    const mapped = data.map((row) => ({
      ...row,
      [TS_KEY]: toTimestamp(row[tk]),
    }));

    return {
      chartData: mapped,
      valueKeys: vk,
      chartConfig: config,
      domain: dm,
      ticks: dm ? generateTicks(dm, maxTicks) : undefined,
    };
  }, [data, timeRange, maxTicks]);

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
    <div
      ref={containerRef}
      className="h-full w-full select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <ChartContainer config={chartConfig} className="h-full w-full">
        <LineChart data={chartData} margin={{ left: 12, right: 12, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey={TS_KEY}
            type="number"
            scale="time"
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
          <ChartTooltip
            content={
              <ChartTooltipContent labelFormatter={formatTooltipLabel} />
            }
          />
          {showLegend && <ChartLegend content={<ChartLegendContent />} />}
          {valueKeys.map((key) => (
            <Line
              key={key}
              dataKey={key}
              type={curveType}
              stroke={`var(--color-${key})`}
              strokeWidth={2}
              dot={false}
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
    </div>
  );
}
