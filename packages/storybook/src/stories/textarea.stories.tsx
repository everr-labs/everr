import { Label } from "@everr/ui/components/label";
import { Textarea } from "@everr/ui/components/textarea";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

const meta = {
  title: "Controls/Textarea",
  component: Textarea,
  args: { placeholder: "Describe what this alert means" },
  argTypes: { disabled: { control: "boolean" } },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithLabel: Story = {
  render: (args) => (
    <div className="grid gap-2">
      <Label htmlFor="summary">Summary</Label>
      <Textarea id="summary" {...args} />
    </div>
  ),
};

export const WithValue: Story = {
  args: {
    defaultValue:
      "The checkout API error rate is above the budget for the last 30 minutes.",
  },
};

export const Rows: Story = {
  args: { rows: 8, defaultValue: "This textarea keeps eight rows of height." },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: "You cannot edit this text." },
};

export const Invalid: Story = {
  render: (args) => (
    <div className="grid gap-2">
      <Label htmlFor="runbook">Runbook</Label>
      <Textarea id="runbook" {...args} aria-invalid defaultValue="" />
      <p className="text-destructive text-xs">The runbook cannot be empty.</p>
    </div>
  ),
};

export const Controlled: Story = {
  render: (args) => {
    const [value, setValue] = React.useState("");

    return (
      <div className="grid gap-2">
        <Textarea
          {...args}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <p className="text-muted-foreground text-xs">
          {value.length} characters
        </p>
      </div>
    );
  },
};
