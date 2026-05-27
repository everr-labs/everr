import {
  type ChartConfig,
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

function getGroupKeys(row: QueryResultRow, timeKey: string): string[] {
  return Object.keys(row).filter(
    (k) => k !== timeKey && typeof row[k] === "string",
  );
}

function sanitizeKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_");
}

function pivotByGroup(
  rows: QueryResultRow[],
  timeKey: string,
  groupKey: string,
  valueKey: string,
): {
  pivoted: QueryResultRow[];
  seriesKeys: string[];
  labelMap: Map<string, string>;
} {
  const byTimestamp = new Map<string | number, QueryResultRow>();
  const seriesSet = new Set<string>();
  const labelMap = new Map<string, string>();

  for (const row of rows) {
    const ts = row[timeKey];
    const group = String(row[groupKey]);
    const key = sanitizeKey(group);
    const raw = row[valueKey];
    const value = typeof raw === "string" ? Number(raw) : raw;
    seriesSet.add(key);
    labelMap.set(key, group);

    let entry = byTimestamp.get(ts as string | number);
    if (!entry) {
      entry = { [timeKey]: ts };
      byTimestamp.set(ts as string | number, entry);
    }
    entry[key] = value;
  }

  const seriesKeys = [...seriesSet].sort();
  const pivoted = [...byTimestamp.values()];
  return { pivoted, seriesKeys, labelMap };
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

function detectInterval(timestamps: number[]): number | null {
  if (timestamps.length < 2) return null;
  const diffs: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    diffs.push(timestamps[i]! - timestamps[i - 1]!);
  }
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)]!;
}

function fillAndClamp(
  rows: Array<Record<string, unknown>>,
  valueKeys: string[],
  domain: [number, number],
  interval: number,
): Array<Record<string, unknown>> {
  const byTs = new Map<number, Record<string, unknown>>();
  for (const row of rows) {
    const ts = row[TS_KEY] as number;
    if (ts >= domain[0] && ts <= domain[1]) {
      byTs.set(ts, row);
    }
  }

  const first = Math.ceil(domain[0] / interval) * interval;
  const result: Array<Record<string, unknown>> = [];
  for (let t = first; t <= domain[1]; t += interval) {
    const existing = byTs.get(t);
    if (existing) {
      result.push(existing);
    } else {
      const empty: Record<string, unknown> = { [TS_KEY]: t };
      for (const k of valueKeys) {
        empty[k] = null;
      }
      result.push(empty);
    }
  }
  return result;
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

  const { chartData, valueKeys, chartConfig } = useMemo(() => {
    if (!data || data.length === 0) {
      return { chartData: [], valueKeys: [], chartConfig: {} };
    }

    const tk = detectTimeKey(data);
    if (!tk) {
      return { chartData: [], valueKeys: [], chartConfig: {} };
    }

    const groupKeys = getGroupKeys(data[0]!, tk);
    const rawValueKeys = getValueKeys(data[0]!, tk);

    let rows: QueryResultRow[];
    let vk: string[];
    let labels: Map<string, string> | undefined;

    if (groupKeys.length >= 1 && rawValueKeys.length === 1) {
      const compositeKey = "__group__";
      const keyed = data.map((row) => ({
        ...row,
        [compositeKey]: groupKeys.map((k) => row[k]).join(" · "),
      }));
      const { pivoted, seriesKeys, labelMap } = pivotByGroup(
        keyed,
        tk,
        compositeKey,
        rawValueKeys[0]!,
      );
      rows = pivoted;
      vk = seriesKeys;
      labels = labelMap;
    } else {
      rows = data;
      vk = rawValueKeys;
    }

    const config: ChartConfig = {};
    for (let i = 0; i < vk.length; i++) {
      config[vk[i]!] = {
        label: labels?.get(vk[i]!) ?? vk[i],
        color: COLORS[i % COLORS.length],
      };
    }

    const mapped = rows.map((row) => ({
      ...row,
      [TS_KEY]: toTimestamp(row[tk]),
    }));

    const timestamps = mapped.map((r) => r[TS_KEY] as number);
    const interval = detectInterval(timestamps);

    let filled: Array<Record<string, unknown>>;
    if (domain && interval && interval > 0) {
      filled = fillAndClamp(mapped, vk, domain, interval);
    } else if (domain) {
      filled = mapped.filter((r) => {
        const ts = r[TS_KEY] as number;
        return ts >= domain[0] && ts <= domain[1];
      });
    } else {
      filled = mapped;
    }

    return { chartData: filled, valueKeys: vk, chartConfig: config };
  }, [data, domain]);

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
