import { SeriesChart } from "@everr/ui/components/series-chart";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

const labels = ["Aug 10", "Aug 11", "Aug 12", "Aug 13", "Aug 14", "Aug 15", "Aug 16"];
const runs = [124, 118, 131, 149, 172, 198, 214];
const successRate = [97, 96, 98, 93, 88, 91, 95];
const formatCount = (value: number) => value.toLocaleString();
const formatPercent = (value: number) => `${value}%`;

const meta = {
  title: "Charts/SeriesChart",
  component: SeriesChart,
  decorators: [(Story) => <div className="w-[640px]">{Story()}</div>],
  args: {
    labels,
    className: "h-75 w-full",
    axes: { left: { format: formatCount } },
    series: [{ id: "runs", label: "Runs", color: "var(--chart-1)", kind: "bar", values: runs }],
  },
} satisfies Meta<typeof SeriesChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bars: Story = {};

export const BarsAndLineOnTwoAxes: Story = {
  args: {
    showLegend: true,
    axes: { left: { format: formatPercent, min: 0, max: 100 }, right: { format: formatCount } },
    series: [
      {
        id: "runs",
        label: "Runs",
        color: "var(--chart-1)",
        kind: "bar",
        values: runs,
        rightAxis: true,
      },
      {
        id: "rate",
        label: "Success rate",
        color: "var(--chart-2)",
        kind: "line",
        values: successRate,
      },
    ],
  },
};

export const StackedWithSelection: Story = {
  args: {
    onSelect: fn(),
    highlight: { from: 2, to: 4 },
    series: [
      {
        id: "ok",
        label: "Success",
        color: "var(--chart-2)",
        kind: "bar",
        stack: "runs",
        values: runs.map((n) => n - 12),
      },
      {
        id: "failed",
        label: "Failure",
        color: "var(--destructive)",
        kind: "bar",
        stack: "runs",
        values: runs.map(() => 12),
      },
    ],
  },
};

export const CompactArea: Story = {
  args: {
    compact: true,
    className: "h-[100px] w-full",
    axes: { left: { format: formatPercent, min: 0, max: 100 } },
    series: [
      { id: "cpu", label: "CPU", color: "var(--chart-1)", kind: "area", values: successRate },
    ],
  },
};
