import { ChartEmptyState, formatChartDate } from "@everr/ui/components/chart-helpers";
import type { Meta, StoryObj } from "@storybook/react-vite";

const dates = Array.from({ length: 7 }, (_, index) => `2026-08-${index + 10}T00:00:00Z`);

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
      {dates.map((date) => (
        <li key={date}>
          {date} → {formatChartDate(date)}
        </li>
      ))}
    </ul>
  ),
};
