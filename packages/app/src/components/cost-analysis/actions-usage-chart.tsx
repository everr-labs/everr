import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@everr/ui/components/chart";
import { ChartEmptyState } from "@everr/ui/components/chart-helpers";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  BREAKDOWN_OTHER_KEY,
  type CostMetric,
  type CostOverTimeBreakdown,
} from "@/data/cost-analysis/schemas";
import { formatCost } from "@/lib/runner-pricing";
import { formatBucket } from "./format-bucket";

export type ActionsUsageDimension = "repo" | "runner";

interface ActionsUsageChartProps {
  data: CostOverTimeBreakdown;
  metric: CostMetric;
}

const SERIES_COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(263, 70%, 50%)",
  "hsl(25, 95%, 53%)",
  "hsl(142, 71%, 45%)",
  "hsl(340, 75%, 55%)",
  "hsl(190, 80%, 45%)",
];

const OTHER_COLOR = "hsl(0, 0%, 55%)";

function toSafeKey(key: string, index: number): string {
  const slug = key.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `s${index}_${slug}`;
}

interface SafeKey {
  safe: string;
  original: string;
}

function buildSafeKeyMap(topKeys: string[]): SafeKey[] {
  return topKeys.map((original, index) => ({
    safe: toSafeKey(original, index),
    original,
  }));
}

function buildConfig(safeKeys: SafeKey[], hasOther: boolean): ChartConfig {
  const config: ChartConfig = {};
  safeKeys.forEach(({ safe, original }, i) => {
    config[safe] = {
      label: original,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
    };
  });
  if (hasOther) {
    config[BREAKDOWN_OTHER_KEY] = { label: "Other", color: OTHER_COLOR };
  }
  return config;
}

function pivotPoints(
  points: CostOverTimeBreakdown["points"],
  safeKeys: SafeKey[],
  hasOther: boolean,
  metric: CostMetric,
): Record<string, string | number>[] {
  const field = metric === "spend" ? "cost" : "minutes";
  return points.map((point) => {
    const out: Record<string, string | number> = { date: point.date };
    const values = point[field];
    for (const { safe, original } of safeKeys) {
      out[safe] = values[original] ?? 0;
    }
    if (hasOther) {
      out[BREAKDOWN_OTHER_KEY] = values[BREAKDOWN_OTHER_KEY] ?? 0;
    }
    return out;
  });
}

function hasAnyValue(data: CostOverTimeBreakdown, metric: CostMetric): boolean {
  const field = metric === "spend" ? "cost" : "minutes";
  return data.points.some((point) =>
    Object.values(point[field]).some((value) => value > 0),
  );
}

export function ActionsUsageChart({ data, metric }: ActionsUsageChartProps) {
  if (!hasAnyValue(data, metric)) {
    return <ChartEmptyState message="No usage data available" />;
  }

  const safeKeys = buildSafeKeyMap(data.topKeys);
  const config = buildConfig(safeKeys, data.hasOther);
  const points = pivotPoints(data.points, safeKeys, data.hasOther, metric);
  const seriesKeys = data.hasOther
    ? [...safeKeys.map((k) => k.safe), BREAKDOWN_OTHER_KEY]
    : safeKeys.map((k) => k.safe);

  const formatValue = (v: number) =>
    metric === "spend" ? formatCost(v) : Math.round(v).toLocaleString();

  return (
    <ChartContainer config={config} className="h-[320px] w-full">
      <BarChart data={points} margin={{ left: 12, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(d) => formatBucket(d, data.granularity, "axis")}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={formatValue}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const date = (payload?.[0]?.payload as { date?: string })?.date;
                return date
                  ? formatBucket(date, data.granularity, "tooltip")
                  : "";
              }}
              formatter={(value, name) => {
                const label =
                  config[String(name) as keyof typeof config]?.label ?? name;
                return (
                  <>
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                      style={{
                        backgroundColor: `var(--color-${String(name)})`,
                      }}
                    />
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono font-medium tabular-nums ml-auto">
                      {formatValue(value as number)}
                    </span>
                  </>
                );
              }}
            />
          }
        />
        <ChartLegend
          content={
            <ChartLegendContent
              nameKey="dataKey"
              payload={seriesKeys.map((key) => ({
                value: key,
                dataKey: key,
                color: config[key]?.color,
                type: "square" as const,
              }))}
            />
          }
          formatter={(value: string) =>
            config[value as keyof typeof config]?.label ?? value
          }
        />
        {seriesKeys.map((key, i) => (
          <Bar
            key={key}
            dataKey={key}
            stackId="usage"
            fill={`var(--color-${key})`}
            radius={i === seriesKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
