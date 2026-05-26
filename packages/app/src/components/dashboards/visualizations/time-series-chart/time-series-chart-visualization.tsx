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

const COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(142, 71%, 45%)",
  "hsl(0, 84%, 60%)",
  "hsl(280, 68%, 60%)",
  "hsl(35, 92%, 50%)",
  "hsl(190, 90%, 50%)",
];

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

function formatTickValue(value: unknown): string {
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    if (value.length > 16) return `${value.slice(0, 16)}…`;
    return value;
  }
  return String(value ?? "");
}

export function TimeSeriesChartVisualization({
  plugin,
  data,
}: VisualizationProps) {
  const showLegend = plugin.spec.showLegend === true;
  const unit = typeof plugin.spec.unit === "string" ? plugin.spec.unit : "";

  const { timeKey, valueKeys, chartConfig } = useMemo(() => {
    if (!data || data.length === 0) {
      return { timeKey: undefined, valueKeys: [], chartConfig: {} };
    }

    const tk = detectTimeKey(data);
    if (!tk) {
      return { timeKey: undefined, valueKeys: [], chartConfig: {} };
    }

    const vk = getValueKeys(data[0]!, tk);
    const config: ChartConfig = {};
    for (let i = 0; i < vk.length; i++) {
      config[vk[i]!] = {
        label: vk[i],
        color: COLORS[i % COLORS.length],
      };
    }

    return { timeKey: tk, valueKeys: vk, chartConfig: config };
  }, [data]);

  if (!data || data.length === 0 || !timeKey) {
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
      <LineChart data={data} margin={{ left: 12, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey={timeKey}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={formatTickValue}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(v) => (unit ? `${v}${unit}` : String(v))}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        {showLegend && <ChartLegend content={<ChartLegendContent />} />}
        {valueKeys.map((key) => (
          <Line
            key={key}
            dataKey={key}
            type="monotone"
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
