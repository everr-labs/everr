import { Button } from "@everr/ui/components/button";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ArrowRightIcon, PlusIcon, TrashIcon } from "lucide-react";

const meta = {
  title: "Controls/Button",
  component: Button,
  args: { children: "Button" },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "outline", "secondary", "ghost", "destructive", "link", "cta"],
    },
    size: {
      control: "select",
      options: ["default", "xs", "sm", "lg", "xl", "icon", "icon-xs", "icon-sm", "icon-lg"],
    },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button {...args} variant="default">
        Default
      </Button>
      <Button {...args} variant="outline">
        Outline
      </Button>
      <Button {...args} variant="secondary">
        Secondary
      </Button>
      <Button {...args} variant="ghost">
        Ghost
      </Button>
      <Button {...args} variant="destructive">
        Destructive
      </Button>
      <Button {...args} variant="link">
        Link
      </Button>
      <Button {...args} variant="cta">
        Call to action
      </Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button {...args} size="xs">
        Extra small
      </Button>
      <Button {...args} size="sm">
        Small
      </Button>
      <Button {...args} size="default">
        Default
      </Button>
      <Button {...args} size="lg">
        Large
      </Button>
      <Button {...args} size="xl">
        Extra large
      </Button>
    </div>
  ),
};

export const IconSizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button {...args} size="icon-xs" aria-label="Add">
        <PlusIcon />
      </Button>
      <Button {...args} size="icon-sm" aria-label="Add">
        <PlusIcon />
      </Button>
      <Button {...args} size="icon" aria-label="Add">
        <PlusIcon />
      </Button>
      <Button {...args} size="icon-lg" aria-label="Add">
        <PlusIcon />
      </Button>
    </div>
  ),
};

export const WithIcons: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button {...args}>
        <PlusIcon data-icon="inline-start" />
        Create rule
      </Button>
      <Button {...args} variant="outline">
        Continue
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
      <Button {...args} variant="destructive">
        <TrashIcon data-icon="inline-start" />
        Delete
      </Button>
    </div>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button {...args} disabled>
        Default
      </Button>
      <Button {...args} variant="outline" disabled>
        Outline
      </Button>
      <Button {...args} variant="destructive" disabled>
        Destructive
      </Button>
    </div>
  ),
};

export const Invalid: Story = {
  args: { "aria-invalid": true, children: "Invalid" },
};

export const AsLink: Story = {
  args: {
    variant: "link",
    children: "Open the docs",
    render: <a href="https://example.com">Open the docs</a>,
  },
};

function LoadingDemo() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"success" | "error">();
  const run = (outcome: "success" | "error", ms: number) => {
    setStatus(undefined);
    setLoading(true);
    setTimeout(() => {
      setStatus(outcome);
      setLoading(false);
    }, ms);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          loading={loading}
          status={status}
          disabled={loading}
          onClick={() => run("success", 1600)}
        >
          Save changes
        </Button>
        <Button
          variant="outline"
          loading={loading}
          status={status}
          disabled={loading}
          onClick={() => run("success", 1600)}
        >
          <PlusIcon data-icon="inline-start" />
          Create key
        </Button>
        <Button
          variant="destructive"
          loading={loading}
          status={status}
          disabled={loading}
          onClick={() => run("error", 1200)}
        >
          <TrashIcon data-icon="inline-start" />
          Revoke (fails)
        </Button>
        <Button
          variant="secondary"
          loading={loading}
          status={status}
          disabled={loading}
          onClick={() => run("success", 90)}
        >
          Fast (90ms)
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Save and Create succeed after 1.6s, Revoke fails after 1.2s, Fast finishes before the
        loading state would show.
      </p>
    </div>
  );
}

/** Click a button: all enter their loading state, then show the outcome. */
export const Loading: Story = {
  render: () => <LoadingDemo />,
};
