import { CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from "recharts";
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
import type { TestDurationTrendPoint } from "@/data/test-results";
import { formatDurationCompact } from "@/lib/formatting";

interface TestDurationTrendChartProps {
  data: TestDurationTrendPoint[];
}

const chartConfig = {
  avgDuration: {
    label: "Average",
    color: "hsl(217, 91%, 60%)",
  },
  p50Duration: {
    label: "P50",
    color: "hsl(142, 71%, 45%)",
  },
  p95Duration: {
    label: "P95",
    color: "hsl(0, 84%, 60%)",
  },
} satisfies ChartConfig;

const tooltipFormatter = createChartTooltipFormatter(chartConfig, (v) =>
  formatDurationCompact(v, "s"),
);
const legendFormatter = createLegendFormatter(chartConfig);

export function TestDurationTrendChart({ data }: TestDurationTrendChartProps) {
  if (data.length === 0) {
    return <ChartEmptyState message="No data available" />;
  }

  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <LineChart data={data} margin={{ left: 12, right: 12 }}>
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
          tickFormatter={(v) => formatDurationCompact(v, "s")}
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
        <Line
          dataKey="avgDuration"
          type="monotone"
          stroke="var(--color-avgDuration)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          dataKey="p50Duration"
          type="monotone"
          stroke="var(--color-p50Duration)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          dataKey="p95Duration"
          type="monotone"
          stroke="var(--color-p95Duration)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
