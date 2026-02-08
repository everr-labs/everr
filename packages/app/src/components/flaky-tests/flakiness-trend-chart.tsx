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
import type { FlakinessTrendPoint } from "@/data/flaky-tests";

interface FlakinessTrendChartProps {
  data: FlakinessTrendPoint[];
}

const chartConfig = {
  flakyCount: {
    label: "Flaky Tests",
    color: "hsl(0, 84%, 60%)",
  },
  totalCount: {
    label: "Total Tests",
    color: "hsl(var(--muted))",
  },
  flakyPercentage: {
    label: "Flaky %",
    color: "hsl(38, 92%, 50%)",
  },
} satisfies ChartConfig;

const tooltipFormatter = createChartTooltipFormatter(chartConfig, (v, name) =>
  name === "flakyPercentage" ? `${v}%` : String(v),
);
const legendFormatter = createLegendFormatter(chartConfig);

export function FlakinessTrendChart({ data }: FlakinessTrendChartProps) {
  if (data.length === 0) {
    return <ChartEmptyState message="No trend data available" />;
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
          domain={[0, 100]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(v) => `${v}%`}
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
          dataKey="flakyCount"
          fill="var(--color-flakyCount)"
          radius={[4, 4, 0, 0]}
        />
        <Line
          yAxisId="right"
          dataKey="flakyPercentage"
          type="monotone"
          stroke="var(--color-flakyPercentage)"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}
