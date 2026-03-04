import { Bar, ComposedChart, Line, XAxis, YAxis } from "recharts";
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
  formatChartDate,
} from "@/components/ui/chart-helpers";
import type { SuccessRatePoint } from "@/data/analytics";

interface SuccessRateMiniChartProps {
  data: SuccessRatePoint[];
}

const chartConfig = {
  totalRuns: {
    label: "Total Runs",
    color: "hsl(217, 91%, 60%)",
  },
  successRate: {
    label: "Success Rate",
    color: "hsl(176, 71%, 45%)",
  },
} satisfies ChartConfig;

const tooltipFormatter = createChartTooltipFormatter(chartConfig, (v, name) =>
  name === "successRate" ? `${v}%` : String(v),
);

export function SuccessRateMiniChart({ data }: SuccessRateMiniChartProps) {
  if (data.length === 0) {
    return <ChartEmptyState message="No success rate data available" />;
  }

  return (
    <ChartContainer config={chartConfig} className="h-40 w-full">
      <ComposedChart data={data} margin={{ left: -20, right: 4 }}>
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          tickFormatter={formatChartDate}
          fontSize={10}
        />
        <YAxis
          yAxisId="left"
          domain={[0, 100]}
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          tickFormatter={(v) => `${v}%`}
          fontSize={10}
          width={40}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickLine={false}
          axisLine={false}
          hide
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={chartTooltipLabelFormatter}
              formatter={tooltipFormatter}
            />
          }
        />
        <Bar
          yAxisId="right"
          dataKey="totalRuns"
          fill="var(--color-totalRuns)"
          radius={[2, 2, 0, 0]}
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
