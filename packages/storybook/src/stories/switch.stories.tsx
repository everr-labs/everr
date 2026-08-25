import { Label } from "@everr/ui/components/label";
import { Switch } from "@everr/ui/components/switch";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

const meta = {
  title: "Controls/Switch",
  component: Switch,
  argTypes: { disabled: { control: "boolean" } },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = {
  args: { defaultChecked: true },
};

export const Disabled: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <Switch {...args} disabled />
      <Switch {...args} disabled defaultChecked />
    </div>
  ),
};

export const WithLabel: Story = {
  render: (args) => (
    <Label htmlFor="polling" className="gap-2">
      <Switch id="polling" {...args} />
      Poll every 30 seconds
    </Label>
  ),
};

export const Controlled: Story = {
  render: (args) => {
    const [checked, setChecked] = React.useState(false);

    return (
      <div className="flex items-center gap-3">
        <Switch {...args} checked={checked} onCheckedChange={setChecked} />
        <span className="text-muted-foreground text-xs">
          {checked ? "Enabled" : "Disabled"}
        </span>
      </div>
    );
  },
};

export const ReadOnly: Story = {
  args: { readOnly: true, defaultChecked: true },
};
