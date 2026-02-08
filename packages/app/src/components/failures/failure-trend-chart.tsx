import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  XAxis,
  YAxis,
} from "recharts";
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
import type { FailureTrendPoint } from "@/data/failures";

interface FailureTrendChartProps {
  data: FailureTrendPoint[];
}

const chartConfig = {
  totalFailures: {
    label: "Total Failures",
    color: "hsl(0, 84%, 60%)",
  },
  uniquePatterns: {
    label: "Unique Patterns",
    color: "hsl(38, 92%, 50%)",
  },
} satisfies ChartConfig;

const tooltipFormatter = createChartTooltipFormatter(chartConfig);
const legendFormatter = createLegendFormatter(chartConfig);

export function FailureTrendChart({ data }: FailureTrendChartProps) {
  if (data.length === 0) {
    return <ChartEmptyState message="No failure data available" />;
  }

  return (
    <ChartContainer config={chartConfig} className="h-75 w-full">
      <ComposedChart data={data} margin={{ left: 12, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={formatChartDate}
        />
        <YAxis
          yAxisId="left"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
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
        <Bar
          yAxisId="left"
          dataKey="totalFailures"
          fill="var(--color-totalFailures)"
          radius={[4, 4, 0, 0]}
        />
        <Line
          yAxisId="right"
          dataKey="uniquePatterns"
          type="monotone"
          stroke="var(--color-uniquePatterns)"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}
