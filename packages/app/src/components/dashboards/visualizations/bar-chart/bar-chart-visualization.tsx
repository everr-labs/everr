import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
} from "@everr/ui/components/chart";
import { BarChart3 } from "lucide-react";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import type { VisualizationProps } from "../index";
import { SeriesTooltipCard } from "../series-tooltip";
import { buildBarChartModel, X_KEY } from "./bar-chart-data";
import type { BarChartSpec } from "./spec";

const MAX_CATEGORY_TICKS = 8;

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

export function BarChartVisualization({
  spec,
  data,
}: VisualizationProps<BarChartSpec>) {
  const { unit, showLegend, stacking, orientation, showValues } = spec;

  const { chartData, valueKeys, chartConfig, isTimeAxis } = useMemo(
    () => buildBarChartModel(data ?? []),
    [data],
  );

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

  const horizontal = orientation === "horizontal";
  const stacked = stacking !== "none";

  const spanMs =
    isTimeAxis && chartData.length > 1
      ? (chartData.at(-1)![X_KEY] as number) - (chartData[0]![X_KEY] as number)
      : 0;
  const formatXTick = isTimeAxis
    ? createTimeTickFormatter(spanMs)
    : (x: string | number) => String(x);
  // With percent stacking the value axis runs 0..1 (stackOffset="expand").
  const formatValueTick = (v: number) =>
    stacking === "percent"
      ? `${Math.round(v * 100)}%`
      : unit
        ? `${v}${unit}`
        : String(v);
  const formatValue = (v: number) =>
    unit ? `${v.toLocaleString()}${unit}` : v.toLocaleString();

  // Dense (time-bucketed) data produces one category per bucket — thin the
  // tick labels instead of letting them overlap.
  const tickInterval = Math.max(
    0,
    Math.ceil(chartData.length / MAX_CATEGORY_TICKS) - 1,
  );

  const categoryAxisProps = {
    dataKey: X_KEY,
    type: "category" as const,
    tickFormatter: formatXTick,
    interval: tickInterval,
  };
  const valueAxisProps = {
    type: "number" as const,
    tickFormatter: formatValueTick,
  };

  return (
    <ChartContainer
      config={chartConfig}
      className="h-full w-full"
      debounce={100}
    >
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
        <ChartTooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const x = payload[0]?.payload?.[X_KEY];
            return (
              <SeriesTooltipCard
                title={
                  isTimeAxis ? new Date(Number(x)).toLocaleString() : String(x)
                }
                rows={payload
                  .filter((item) => typeof item.value === "number")
                  .map((item) => {
                    const key = String(item.dataKey);
                    return {
                      key,
                      color: chartConfig[key]?.color,
                      label: chartConfig[key]?.label ?? key,
                      value: formatValue(item.value as number),
                    };
                  })}
              />
            );
          }}
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
                formatter={(v: unknown) =>
                  typeof v === "number" ? formatValue(v) : ""
                }
              />
            )}
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  );
}
