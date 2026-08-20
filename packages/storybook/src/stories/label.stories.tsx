import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { Switch } from "@everr/ui/components/switch";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { InfoIcon } from "lucide-react";

const meta = {
  title: "Controls/Label",
  component: Label,
  args: { children: "Service" },
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithInput: Story = {
  render: (args) => (
    <div className="grid max-w-xs gap-2">
      <Label htmlFor="service" {...args} />
      <Input id="service" placeholder="checkout-api" />
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <Label htmlFor="budget">
      Error budget
      <InfoIcon className="text-muted-foreground size-3.5" />
    </Label>
  ),
};

export const WithDisabledControl: Story = {
  render: () => (
    <div className="grid max-w-xs gap-2">
      <Input id="locked" className="peer" disabled value="Locked" />
      <Label htmlFor="locked">This label dims with the disabled input</Label>
    </div>
  ),
};

export const InlineWithSwitch: Story = {
  render: () => (
    <Label htmlFor="notify" className="gap-2">
      <Switch id="notify" />
      Send a notification
    </Label>
  ),
};
