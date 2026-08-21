import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

const meta = {
  title: "Controls/Input",
  component: Input,
  args: { placeholder: "service.name" },
  argTypes: {
    type: {
      control: "select",
      options: ["text", "email", "password", "number", "search", "file"],
    },
    disabled: { control: "boolean" },
  },
  decorators: [
    (Story) => (
      <div className="max-w-xs">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithLabel: Story = {
  render: (args) => (
    <div className="grid gap-2">
      <Label htmlFor="service">Service</Label>
      <Input id="service" {...args} />
    </div>
  ),
};

export const Types: Story = {
  render: (args) => (
    <div className="grid gap-3">
      <Input {...args} type="text" placeholder="Text" />
      <Input {...args} type="email" placeholder="name@example.com" />
      <Input {...args} type="password" placeholder="Password" />
      <Input {...args} type="number" placeholder="42" />
      <Input {...args} type="search" placeholder="Search" />
      <Input {...args} type="file" placeholder="" />
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true, value: "Read only value" },
};

export const Invalid: Story = {
  render: (args) => (
    <div className="grid gap-2">
      <Label htmlFor="threshold">Threshold</Label>
      <Input id="threshold" {...args} aria-invalid defaultValue="-1" />
      <p className="text-destructive text-xs">
        The threshold must be positive.
      </p>
    </div>
  ),
};

export const Controlled: Story = {
  render: (args) => {
    const [value, setValue] = React.useState("checkout-api");

    return (
      <div className="grid gap-2">
        <Input
          {...args}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <p className="text-muted-foreground text-xs">
          Value: {value || "None"}
        </p>
      </div>
    );
  },
};
