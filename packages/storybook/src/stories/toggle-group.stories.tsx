import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
} from "lucide-react";
import * as React from "react";

const meta = {
  title: "Controls/ToggleGroup",
  component: ToggleGroup,
  argTypes: {
    variant: { control: "select", options: ["default", "outline"] },
    size: { control: "select", options: ["default", "sm", "lg"] },
    orientation: {
      control: "inline-radio",
      options: ["horizontal", "vertical"],
    },
    spacing: { control: { type: "number", min: 0, max: 4 } },
  },
  render: (args) => (
    <ToggleGroup {...args}>
      <ToggleGroupItem value="left" aria-label="Align left">
        <AlignLeftIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="center" aria-label="Align center">
        <AlignCenterIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="Align right">
        <AlignRightIcon />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
} satisfies Meta<typeof ToggleGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Outline: Story = {
  args: { variant: "outline" },
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col items-start gap-3">
      <ToggleGroup {...args} size="sm">
        <ToggleGroupItem value="bold" aria-label="Bold">
          <BoldIcon />
        </ToggleGroupItem>
        <ToggleGroupItem value="italic" aria-label="Italic">
          <ItalicIcon />
        </ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup {...args} size="default">
        <ToggleGroupItem value="bold" aria-label="Bold">
          <BoldIcon />
        </ToggleGroupItem>
        <ToggleGroupItem value="italic" aria-label="Italic">
          <ItalicIcon />
        </ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup {...args} size="lg">
        <ToggleGroupItem value="bold" aria-label="Bold">
          <BoldIcon />
        </ToggleGroupItem>
        <ToggleGroupItem value="italic" aria-label="Italic">
          <ItalicIcon />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  ),
};

export const WithSpacing: Story = {
  args: { variant: "outline", spacing: 2 },
};

export const Vertical: Story = {
  args: { variant: "outline", orientation: "vertical" },
};

export const WithText: Story = {
  args: { variant: "outline", defaultValue: ["firing"] },
  render: (args) => (
    <ToggleGroup {...args}>
      <ToggleGroupItem value="firing">Firing</ToggleGroupItem>
      <ToggleGroupItem value="pending">Pending</ToggleGroupItem>
      <ToggleGroupItem value="resolved">Resolved</ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const Multiple: Story = {
  args: { variant: "outline", multiple: true, defaultValue: ["bold"] },
  render: (args) => (
    <ToggleGroup {...args}>
      <ToggleGroupItem value="bold" aria-label="Bold">
        <BoldIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="italic" aria-label="Italic">
        <ItalicIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="underline" aria-label="Underline">
        <UnderlineIcon />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const DisabledItem: Story = {
  args: { variant: "outline" },
  render: (args) => (
    <ToggleGroup {...args}>
      <ToggleGroupItem value="firing">Firing</ToggleGroupItem>
      <ToggleGroupItem value="pending" disabled>
        Pending
      </ToggleGroupItem>
      <ToggleGroupItem value="resolved">Resolved</ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const Controlled: Story = {
  render: (args) => {
    const [value, setValue] = React.useState<string[]>(["center"]);

    return (
      <div className="flex flex-col items-start gap-3">
        <ToggleGroup {...args} value={value} onValueChange={setValue}>
          <ToggleGroupItem value="left" aria-label="Align left">
            <AlignLeftIcon />
          </ToggleGroupItem>
          <ToggleGroupItem value="center" aria-label="Align center">
            <AlignCenterIcon />
          </ToggleGroupItem>
          <ToggleGroupItem value="right" aria-label="Align right">
            <AlignRightIcon />
          </ToggleGroupItem>
        </ToggleGroup>
        <span className="text-muted-foreground text-xs">
          {value[0] ?? "None"}
        </span>
      </div>
    );
  },
};
