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
import type { SuccessRatePoint } from "@/data/analytics";

interface SuccessRateChartProps {
  data: SuccessRatePoint[];
}

const chartConfig = {
  totalRuns: {
    label: "Total Runs",
    color: "hsl(var(--muted))",
  },
  successRate: {
    label: "Success Rate",
    color: "hsl(142, 71%, 45%)",
  },
} satisfies ChartConfig;

const tooltipFormatter = createChartTooltipFormatter(chartConfig, (v, name) =>
  name === "successRate" ? `${v}%` : String(v),
);
const legendFormatter = createLegendFormatter(chartConfig);

export function SuccessRateChart({ data }: SuccessRateChartProps) {
  if (data.length === 0) {
    return <ChartEmptyState message="No success rate data available" />;
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
          domain={[0, 100]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(v) => `${v}%`}
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
          yAxisId="right"
          dataKey="totalRuns"
          fill="var(--color-totalRuns)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
        <Line
          yAxisId="left"
          dataKey="successRate"
          type="monotone"
          stroke="var(--color-successRate)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}
