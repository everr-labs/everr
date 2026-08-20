import { Button } from "@everr/ui/components/button";
import { Toaster } from "@everr/ui/components/sonner";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { toast } from "sonner";

const meta = {
  title: "Overlays/Sonner",
  component: Toaster,
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

function saveRule(shouldFail: boolean) {
  return new Promise<{ name: string }>((resolve, reject) => {
    setTimeout(() => {
      if (shouldFail) {
        reject(new Error("The rule was refused by the server."));
        return;
      }
      resolve({ name: "checkout-error-rate" });
    }, 1500);
  });
}

export const Default: Story = {
  render: (args) => (
    <div className="flex flex-wrap gap-2">
      <Toaster {...args} />
      <Button variant="outline" onClick={() => toast("The rule was applied.")}>
        Default
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.success("The rule was applied.")}
      >
        Success
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.info("Two rules match this service.")}
      >
        Info
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.warning("The rule has no destination.")}
      >
        Warning
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.error("The rule was refused by the server.")}
      >
        Error
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.loading("Applying the rule...")}
      >
        Loading
      </Button>
    </div>
  ),
};

export const WithPromise: Story = {
  render: (args) => (
    <div className="flex flex-wrap gap-2">
      <Toaster {...args} />
      <Button
        variant="outline"
        onClick={() =>
          toast.promise(saveRule(false), {
            loading: "Applying the rule...",
            success: (rule) => `${rule.name} is now active.`,
            error: (error: Error) => error.message,
          })
        }
      >
        Promise that resolves
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.promise(saveRule(true), {
            loading: "Applying the rule...",
            success: (rule) => `${rule.name} is now active.`,
            error: (error: Error) => error.message,
          })
        }
      >
        Promise that rejects
      </Button>
    </div>
  ),
};

export const WithDescriptionAndAction: Story = {
  render: (args) => (
    <div className="flex flex-wrap gap-2">
      <Toaster {...args} />
      <Button
        variant="outline"
        onClick={() =>
          toast.error("The rule was refused by the server.", {
            description: "The threshold must be a number above zero.",
            action: {
              label: "Retry",
              onClick: () => toast.success("Applied."),
            },
          })
        }
      >
        With description and action
      </Button>
      <Button variant="outline" onClick={() => toast.dismiss()}>
        Dismiss all
      </Button>
    </div>
  ),
};

export const TopCenter: Story = {
  args: { position: "top-center" },
  render: (args) => (
    <div className="flex flex-wrap gap-2">
      <Toaster {...args} />
      <Button
        variant="outline"
        onClick={() => toast.success("The rule was applied.")}
      >
        Toast at the top
      </Button>
    </div>
  ),
};
