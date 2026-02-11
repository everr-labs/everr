import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  ChartEmptyState,
  chartTooltipLabelFormatter,
  createChartTooltipFormatter,
  createLegendFormatter,
  formatChartDate,
} from "@/components/ui/chart-helpers";
import type { CostOverTimePoint } from "@/data/cost-analysis";
import { formatCost } from "@/lib/runner-pricing";

interface CostOverTimeChartProps {
  data: CostOverTimePoint[];
}

const chartConfig = {
  linuxCost: {
    label: "Linux",
    color: "hsl(217, 91%, 60%)",
  },
  windowsCost: {
    label: "Windows",
    color: "hsl(263, 70%, 50%)",
  },
  macosCost: {
    label: "macOS",
    color: "hsl(25, 95%, 53%)",
  },
} satisfies ChartConfig;

export function CostOverTimeChart({ data }: CostOverTimeChartProps) {
  if (data.length === 0) {
    return <ChartEmptyState message="No cost data available" />;
  }

  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <BarChart data={data} margin={{ left: 12, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={formatChartDate}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(v) => formatCost(v)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={createChartTooltipFormatter(chartConfig, (v) =>
                formatCost(v),
              )}
              labelFormatter={chartTooltipLabelFormatter}
            />
          }
        />
        <ChartLegend
          content={
            <ChartLegendContent
              nameKey="dataKey"
              payload={Object.entries(chartConfig).map(([key, value]) => ({
                value: key,
                dataKey: key,
                color: value.color,
                type: "square" as const,
              }))}
            />
          }
          formatter={createLegendFormatter(chartConfig)}
        />
        <Bar
          dataKey="linuxCost"
          stackId="cost"
          fill="var(--color-linuxCost)"
          radius={[0, 0, 0, 0]}
          isAnimationActive={false}
        />
        <Bar
          dataKey="windowsCost"
          stackId="cost"
          fill="var(--color-windowsCost)"
          radius={[0, 0, 0, 0]}
          isAnimationActive={false}
        />
        <Bar
          dataKey="macosCost"
          stackId="cost"
          fill="var(--color-macosCost)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}
