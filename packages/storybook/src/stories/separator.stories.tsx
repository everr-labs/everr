import { Separator } from "@everr/ui/components/separator";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  title: "Layout/Separator",
  component: Separator,
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  args: { orientation: "horizontal" },
  render: (args) => (
    <div className="w-72">
      <p className="font-medium">Traces</p>
      <p className="text-muted-foreground">Sampled spans by service</p>
      <Separator {...args} className="my-3" />
      <p className="text-muted-foreground">Retention is 7 days.</p>
    </div>
  ),
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
  render: (args) => (
    <div className="flex h-6 items-center gap-3">
      <span>Logs</span>
      <Separator {...args} />
      <span>Traces</span>
      <Separator {...args} />
      <span>Metrics</span>
    </div>
  ),
};
