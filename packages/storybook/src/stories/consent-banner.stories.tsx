import { Button } from "@everr/ui/components/button";
import { ConsentBanner } from "@everr/ui/components/consent-banner";
import { ConsentSettingsDialog } from "@everr/ui/components/consent-settings-dialog";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

const meta = {
  title: "Overlays/ConsentBanner",
  component: ConsentBanner,
  args: {
    open: true,
    onAcceptAll: () => {},
    onDeny: () => {},
  },
} satisfies Meta<typeof ConsentBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="min-h-72">
      <ConsentBanner {...args} />
    </div>
  ),
};

export const WithSettingsButton: Story = {
  args: { onOpenSettings: () => {} },
  render: (args) => (
    <div className="min-h-72">
      <ConsentBanner {...args} />
    </div>
  ),
};

export const CustomCopy: Story = {
  args: {
    title: "Help us improve Everr",
    description:
      "We store anonymous usage data in your browser. It tells us which parts of the product are used. You can change this at any time.",
  },
  render: (args) => (
    <div className="min-h-72">
      <ConsentBanner {...args} />
    </div>
  ),
};

export const Closed: Story = {
  args: { open: false },
  render: (args) => (
    <div className="text-muted-foreground min-h-24">
      <p>The banner shows nothing when `open` is false.</p>
      <ConsentBanner {...args} />
    </div>
  ),
};

export const WithSettingsDialog: Story = {
  render: function WithSettingsDialogStory() {
    const [decided, setDecided] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [analyticsEnabled, setAnalyticsEnabled] = useState(false);

    return (
      <div className="min-h-72">
        {decided && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDecided(false);
            }}
          >
            Ask again
          </Button>
        )}
        <ConsentBanner
          open={!decided}
          onAcceptAll={() => {
            setAnalyticsEnabled(true);
            setDecided(true);
          }}
          onDeny={() => {
            setAnalyticsEnabled(false);
            setDecided(true);
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <ConsentSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          analyticsEnabled={analyticsEnabled}
          onAnalyticsChange={setAnalyticsEnabled}
          onDeny={() => {
            setAnalyticsEnabled(false);
            setSettingsOpen(false);
            setDecided(true);
          }}
          onAcceptAll={() => {
            setAnalyticsEnabled(true);
            setSettingsOpen(false);
            setDecided(true);
          }}
          onSave={() => {
            setSettingsOpen(false);
            setDecided(true);
          }}
        />
      </div>
    );
  },
};
