import { toggleVariants } from "@everr/ui/components/toggle";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { BoldIcon, ItalicIcon, UnderlineIcon } from "lucide-react";
import * as React from "react";

type ToggleProps = React.ComponentProps<"button"> & {
  variant?: "default" | "outline";
  size?: "default" | "sm" | "lg";
  pressed?: boolean;
  defaultPressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
};

// The package exports only the class recipe, so the stories drive the pressed
// state themselves.
function Toggle({
  className,
  variant,
  size,
  pressed,
  defaultPressed = false,
  onPressedChange,
  onClick,
  ...props
}: ToggleProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultPressed);
  const isPressed = pressed ?? uncontrolled;

  return (
    <button
      type="button"
      data-slot="toggle"
      aria-pressed={isPressed}
      className={toggleVariants({ variant, size, className })}
      onClick={(event) => {
        onClick?.(event);
        setUncontrolled(!isPressed);
        onPressedChange?.(!isPressed);
      }}
      {...props}
    />
  );
}

const meta = {
  title: "Controls/Toggle",
  component: Toggle,
  args: { children: <BoldIcon />, "aria-label": "Bold" },
  argTypes: {
    variant: { control: "select", options: ["default", "outline"] },
    size: { control: "select", options: ["default", "sm", "lg"] },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Toggle {...args} variant="default" />
      <Toggle {...args} variant="outline" />
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Toggle {...args} size="sm" />
      <Toggle {...args} size="default" />
      <Toggle {...args} size="lg" />
    </div>
  ),
};

export const Pressed: Story = {
  args: { defaultPressed: true },
};

export const WithText: Story = {
  args: {
    "aria-label": undefined,
    children: (
      <>
        <ItalicIcon />
        Italic
      </>
    ),
  },
};

export const Disabled: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Toggle {...args} disabled />
      <Toggle {...args} disabled defaultPressed />
    </div>
  ),
};

export const Invalid: Story = {
  args: { "aria-invalid": true },
};

export const Controlled: Story = {
  render: (args) => {
    const [pressed, setPressed] = React.useState(false);

    return (
      <div className="flex items-center gap-3">
        <Toggle
          {...args}
          aria-label="Underline"
          pressed={pressed}
          onPressedChange={setPressed}
        >
          <UnderlineIcon />
        </Toggle>
        <span className="text-muted-foreground text-xs">
          {pressed ? "On" : "Off"}
        </span>
      </div>
    );
  },
};
