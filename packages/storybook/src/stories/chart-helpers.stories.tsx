import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@everr/ui/components/chart";
import {
  ChartEmptyState,
  chartTooltipLabelFormatter,
  createChartTooltipFormatter,
  createLegendFormatter,
  formatChartDate,
} from "@everr/ui/components/chart-helpers";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

const requestRate = [1240, 1180, 1310, 1490, 1720, 1980, 2140];
const p95Latency = [182, 176, 191, 214, 268, 342, 401];

const series = requestRate.map((requests, index) => ({
  date: `2026-08-${String(index + 10).padStart(2, "0")}T00:00:00Z`,
  requests,
  latency: p95Latency[index],
}));

const config = {
  requests: { label: "Requests / s", color: "var(--chart-1)" },
  latency: { label: "p95 latency (ms)", color: "var(--chart-2)" },
} satisfies ChartConfig;

const meta = {
  title: "Charts/ChartHelpers",
  component: ChartEmptyState,
  args: { message: "No data for the selected time range" },
} satisfies Meta<typeof ChartEmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyState: Story = {};

export const EmptyStateAfterFilter: Story = {
  args: { message: "No series match the current filters" },
};

export const FormatChartDate: Story = {
  render: () => (
    <ul className="text-sm font-mono">
      {series.map((point) => (
        <li key={point.date}>
          {point.date} → {formatChartDate(point.date)}
        </li>
      ))}
    </ul>
  ),
};

export const TooltipFormatters: Story = {
  render: () => (
    <ChartContainer config={config} className="aspect-auto h-[300px] w-[640px]">
      <BarChart data={series}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickFormatter={formatChartDate}
        />
        <YAxis tickLine={false} axisLine={false} width={44} />
        <ChartTooltip
          labelFormatter={chartTooltipLabelFormatter}
          content={
            <ChartTooltipContent
              formatter={createChartTooltipFormatter(config, (value, name) =>
                name === "latency"
                  ? `${value} ms`
                  : `${value.toLocaleString()} rps`,
              )}
            />
          }
        />
        <Bar
          dataKey="requests"
          fill="var(--color-requests)"
          radius={4}
          isAnimationActive={false}
        />
        <Bar
          dataKey="latency"
          fill="var(--color-latency)"
          radius={4}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  ),
};

export const LegendFormatter: Story = {
  render: () => (
    <ChartContainer config={config} className="aspect-auto h-[300px] w-[640px]">
      <BarChart data={series}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickFormatter={formatChartDate}
        />
        <YAxis tickLine={false} axisLine={false} width={44} />
        <ChartLegend
          formatter={createLegendFormatter(config)}
          content={<ChartLegendContent />}
        />
        <Bar
          dataKey="requests"
          fill="var(--color-requests)"
          radius={4}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  ),
};
