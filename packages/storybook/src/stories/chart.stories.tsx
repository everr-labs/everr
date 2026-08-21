import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
  ChartTooltip,
  ChartTooltipContent,
} from "@everr/ui/components/chart";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

const requestRate = [
  1240, 1180, 1310, 1490, 1720, 1980, 2140, 2060, 1890, 1650, 1420, 1290,
];
const p95Latency = [182, 176, 191, 214, 268, 342, 401, 377, 310, 254, 208, 190];
const errorRate = [0.4, 0.3, 0.5, 0.8, 1.4, 2.6, 3.9, 3.1, 1.9, 1.1, 0.6, 0.4];

const series = requestRate.map((requests, index) => ({
  time: `${String(index * 2).padStart(2, "0")}:00`,
  requests,
  latency: p95Latency[index],
  errors: errorRate[index],
}));

const config = {
  requests: { label: "Requests / s", color: "var(--chart-1)" },
  latency: { label: "p95 latency (ms)", color: "var(--chart-2)" },
  errors: { label: "Error rate (%)", color: "var(--chart-3)" },
} satisfies ChartConfig;

const meta = {
  title: "Charts/Chart",
  component: ChartContainer,
  args: {
    config,
    className: "aspect-auto h-[300px] w-[640px]",
    children: (
      <LineChart data={series}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="time" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={40} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          dataKey="requests"
          stroke="var(--color-requests)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    ),
  },
} satisfies Meta<typeof ChartContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Line_: Story = { name: "Line" };

export const Bars: Story = {
  args: {
    children: (
      <BarChart data={series}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="time" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={40} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar
          dataKey="latency"
          fill="var(--color-latency)"
          radius={4}
          isAnimationActive={false}
        />
      </BarChart>
    ),
  },
};

export const StackedArea: Story = {
  args: {
    children: (
      <AreaChart data={series}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="time" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={40} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Area
          dataKey="requests"
          stackId="a"
          stroke="var(--color-requests)"
          fill="var(--color-requests)"
          fillOpacity={0.3}
          isAnimationActive={false}
        />
        <Area
          dataKey="latency"
          stackId="a"
          stroke="var(--color-latency)"
          fill="var(--color-latency)"
          fillOpacity={0.3}
          isAnimationActive={false}
        />
      </AreaChart>
    ),
  },
};

export const WithLegend: Story = {
  args: {
    children: (
      <LineChart data={series}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="time" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={40} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          dataKey="requests"
          stroke="var(--color-requests)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="latency"
          stroke="var(--color-latency)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    ),
  },
};

export const LegendOnTop: Story = {
  args: {
    children: (
      <BarChart data={series}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="time" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={40} />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <ChartLegend
          verticalAlign="top"
          content={<ChartLegendContent verticalAlign="top" />}
        />
        <Bar
          dataKey="errors"
          fill="var(--color-errors)"
          radius={4}
          isAnimationActive={false}
        />
      </BarChart>
    ),
  },
};

export const TooltipIndicators: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {(["dot", "line", "dashed"] as const).map((indicator) => (
        <div key={indicator} className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs">{indicator}</span>
          <ChartContainer
            config={config}
            className="aspect-auto h-[160px] w-[640px]"
          >
            <LineChart data={series}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="time" tickLine={false} axisLine={false} />
              <ChartTooltip
                defaultIndex={5}
                active
                content={<ChartTooltipContent indicator={indicator} />}
              />
              <Line
                dataKey="requests"
                stroke="var(--color-requests)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartContainer>
        </div>
      ))}
    </div>
  ),
};

export const ChartStyleOnly: Story = {
  render: () => (
    <div className="flex flex-col gap-3" data-chart="chart-style-demo">
      <ChartStyle id="chart-style-demo" config={config} />
      {Object.entries(config).map(([key, item]) => (
        <div key={key} className="flex items-center gap-2 text-sm">
          <span
            className="size-3 rounded-[2px]"
            style={{ backgroundColor: `var(--color-${key})` }}
          />
          {item.label}
        </div>
      ))}
    </div>
  ),
};
