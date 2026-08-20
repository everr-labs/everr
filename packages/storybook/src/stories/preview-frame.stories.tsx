import { Button } from "@everr/ui/components/button";
import { PreviewFrame } from "@everr/ui/components/preview-frame";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { EyeIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

const meta = {
  title: "Layout/PreviewFrame",
  component: PreviewFrame,
  args: {
    variant: "info",
    icon: <EyeIcon className="size-3.5" />,
    message: "You are viewing a preview of unapplied changes.",
  },
} satisfies Meta<typeof PreviewFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

const body = (
  <div className="text-muted-foreground flex-1 p-4">
    The framed page content renders below the bar.
  </div>
);

export const Default: Story = {
  render: (args) => (
    <div className="h-64 w-[36rem] overflow-hidden rounded-lg">
      <PreviewFrame {...args}>{body}</PreviewFrame>
    </div>
  ),
};

export const WithActions: Story = {
  render: (args) => (
    <div className="h-64 w-[36rem] overflow-hidden rounded-lg">
      <PreviewFrame
        {...args}
        actions={
          <Button variant="ghost" size="sm">
            Exit preview
          </Button>
        }
      >
        {body}
      </PreviewFrame>
    </div>
  ),
};

export const Dismissible: Story = {
  render: function Dismissible(args) {
    const [dismissed, setDismissed] = useState(false);
    return (
      <div className="grid gap-2">
        <div className="h-64 w-[36rem] overflow-hidden rounded-lg">
          <PreviewFrame
            {...args}
            dismissed={dismissed}
            onDismiss={() => setDismissed(true)}
            actions={
              <Button variant="ghost" size="sm">
                Exit preview
              </Button>
            }
          >
            {body}
          </PreviewFrame>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setDismissed(false)}
        >
          Restore bar
        </Button>
      </div>
    );
  },
};

export const Variants: Story = {
  render: (args) => (
    <div className="grid gap-3">
      {(["neutral", "info", "success", "warning", "danger"] as const).map(
        (variant) => (
          <div
            key={variant}
            className="h-24 w-[36rem] overflow-hidden rounded-lg"
          >
            <PreviewFrame
              {...args}
              variant={variant}
              icon={<TriangleAlertIcon className="size-3.5" />}
              message={`Variant: ${variant}`}
            >
              {body}
            </PreviewFrame>
          </div>
        ),
      )}
    </div>
  ),
};
