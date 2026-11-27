import { ChartEmptyState } from "@everr/ui/components/chart-helpers";
import type { Meta, StoryObj } from "@storybook/react-vite";

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
