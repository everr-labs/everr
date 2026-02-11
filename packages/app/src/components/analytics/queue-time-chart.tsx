import { Area, AreaChart, CartesianGrid, Legend, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
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
import type { QueueTimePoint } from "@/data/analytics";
import { formatDurationCompact } from "@/lib/formatting";

interface QueueTimeChartProps {
  data: QueueTimePoint[];
}

const chartConfig = {
  p95QueueTime: {
    label: "P95",
    color: "hsl(38, 92%, 50%)",
  },
  avgQueueTime: {
    label: "Average",
    color: "hsl(217, 91%, 60%)",
  },
} satisfies ChartConfig;

const tooltipFormatter = createChartTooltipFormatter(chartConfig, (v) =>
  formatDurationCompact(v),
);
const legendFormatter = createLegendFormatter(chartConfig);

export function QueueTimeChart({ data }: QueueTimeChartProps) {
  if (data.length === 0) {
    return <ChartEmptyState message="No queue time data available" />;
  }

  return (
    <ChartContainer config={chartConfig} className="h-75 w-full">
      <AreaChart data={data} margin={{ left: 12, right: 12 }}>
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
          tickFormatter={(v) => formatDurationCompact(v)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={chartTooltipLabelFormatter}
              formatter={tooltipFormatter}
            />
          }
        />
        <Legend formatter={legendFormatter} />
        <Area
          dataKey="p95QueueTime"
          type="monotone"
          fill="var(--color-p95QueueTime)"
          fillOpacity={0.2}
          stroke="var(--color-p95QueueTime)"
          isAnimationActive={false}
        />
        <Area
          dataKey="avgQueueTime"
          type="monotone"
          fill="var(--color-avgQueueTime)"
          fillOpacity={0.4}
          stroke="var(--color-avgQueueTime)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
