import { Sparkline } from "@everr/ui/components/sparkline";
import type { Meta, StoryObj } from "@storybook/react-vite";

const requestRate = [
  1240, 1180, 1310, 1490, 1720, 1980, 2140, 2060, 1890, 1650, 1420, 1290,
];
const p95Latency = [182, 176, 191, 214, 268, 342, 401, 377, 310, 254, 208, 190];
const errorRate = [0.4, 0.3, 0.5, 0.8, 1.4, 2.6, 3.9, 3.1, 1.9, 1.1, 0.6, 0.4];

const meta = {
  title: "Charts/Sparkline",
  component: Sparkline,
  args: { data: requestRate },
} satisfies Meta<typeof Sparkline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Large: Story = {
  args: { width: 320, height: 80 },
};

export const ErrorRate: Story = {
  args: { data: errorRate, color: "var(--chart-3)" },
};

export const Latency: Story = {
  args: { data: p95Latency, color: "var(--chart-2)" },
};

export const FixedMaxValue: Story = {
  args: { data: errorRate, maxValue: 100, color: "var(--chart-3)" },
};

export const SinglePoint: Story = {
  args: { data: [42] },
};

export const NoData: Story = {
  args: { data: [] },
};

export const Stretched: Story = {
  args: { className: "h-16 w-full" },
  decorators: [
    (Story) => (
      <div className="w-[480px]">
        <Story />
      </div>
    ),
  ],
};

export const InlineWithMetric: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {[
        {
          label: "Requests / s",
          data: requestRate,
          color: "var(--chart-1)",
        },
        { label: "p95 latency", data: p95Latency, color: "var(--chart-2)" },
        { label: "Error rate", data: errorRate, color: "var(--chart-3)" },
      ].map((row) => (
        <div key={row.label} className="flex items-center gap-3 text-sm">
          <span className="w-28 text-muted-foreground">{row.label}</span>
          <Sparkline data={row.data} color={row.color} />
          <span className="font-mono tabular-nums">
            {row.data[row.data.length - 1]}
          </span>
        </div>
      ))}
    </div>
  ),
};
