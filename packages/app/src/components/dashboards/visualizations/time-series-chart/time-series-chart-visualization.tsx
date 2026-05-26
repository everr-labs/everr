import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@everr/ui/components/chart";
import { LineChart as LineChartIcon } from "lucide-react";
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
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
    const ms = new Date(value.replace(" ", "T") + "Z").getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

function formatTick(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTooltipLabel(
  _label: unknown,
  payload: Array<{ payload?: Record<string, unknown> }>,
): string {
  const ts = payload[0]?.payload?.[TS_KEY];
  if (typeof ts === "number") return new Date(ts).toLocaleString();
  return String(_label);
}

export function TimeSeriesChartVisualization({
  plugin,
  data,
  timeRange,
}: VisualizationProps) {
  const showLegend = plugin.spec.showLegend === true;
  const unit = typeof plugin.spec.unit === "string" ? plugin.spec.unit : "";
  const curveType: CurveType =
    typeof plugin.spec.curveType === "string"
      ? (plugin.spec.curveType as CurveType)
      : "monotone";

  const { chartData, valueKeys, chartConfig, domain } = useMemo(() => {
    if (!data || data.length === 0) {
      return {
        chartData: [],
        valueKeys: [],
        chartConfig: {},
        domain: undefined,
      };
    }

    const tk = detectTimeKey(data);
    if (!tk) {
      return {
        chartData: [],
        valueKeys: [],
        chartConfig: {},
        domain: undefined,
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

    const dm: [number, number] | undefined = timeRange
      ? [timeRange.from.getTime(), timeRange.to.getTime()]
      : undefined;

    return {
      chartData: mapped,
      valueKeys: vk,
      chartConfig: config,
      domain: dm,
    };
  }, [data, timeRange]);

  if (chartData.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <LineChartIcon className="size-8" />
        <p className="text-sm">
          {!data || data.length === 0
            ? "No data — run a query to see results"
            : "No time column detected"}
        </p>
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-full w-full">
      <LineChart data={chartData} margin={{ left: 12, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey={TS_KEY}
          type="number"
          scale="time"
          domain={domain ?? ["dataMin", "dataMax"]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={formatTick}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(v) => (unit ? `${v}${unit}` : String(v))}
        />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={formatTooltipLabel} />}
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
      </LineChart>
    </ChartContainer>
  );
}
