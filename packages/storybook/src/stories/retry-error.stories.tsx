import { RetryError } from "@everr/ui/components/retry-error";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  title: "Data/RetryError",
  component: RetryError,
  args: {
    title: "Could not load services",
    message: "The query timed out after 30 seconds.",
    onRetry: () => {},
  },
} satisfies Meta<typeof RetryError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongMessage: Story = {
  args: {
    title: "Could not load alert instances",
    message:
      "ClickHouse rejected the query because the time range exceeds the retention window. Pick a shorter range and try again.",
  },
};

export const InsideCard: Story = {
  render: (args) => (
    <div className="w-[28rem] rounded-xl border border-border bg-card">
      <RetryError {...args} />
    </div>
  ),
};
