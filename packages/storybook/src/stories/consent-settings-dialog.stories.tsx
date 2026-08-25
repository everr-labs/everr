import { Button } from "@everr/ui/components/button";
import { ConsentSettingsDialog } from "@everr/ui/components/consent-settings-dialog";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

const meta = {
  title: "Overlays/ConsentSettingsDialog",
  component: ConsentSettingsDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    analyticsEnabled: false,
    onAnalyticsChange: () => {},
    onDeny: () => {},
    onAcceptAll: () => {},
    onSave: () => {},
  },
} satisfies Meta<typeof ConsentSettingsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AnalyticsEnabled: Story = {
  args: { analyticsEnabled: true },
};

export const WithPrivacyPolicy: Story = {
  args: { privacyPolicyHref: "https://example.com/privacy" },
};

export const CustomDescription: Story = {
  args: {
    description:
      "Everr stores a small amount of usage data in your browser. Select the categories you accept.",
  },
};

export const Interactive: Story = {
  render: function InteractiveStory(args) {
    const [open, setOpen] = useState(true);
    const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
    const [saved, setSaved] = useState<string | null>(null);

    return (
      <div className="flex flex-col items-start gap-3">
        <Button variant="outline" onClick={() => setOpen(true)}>
          Open consent settings
        </Button>
        {saved && <p className="text-muted-foreground text-xs">{saved}</p>}
        <ConsentSettingsDialog
          {...args}
          open={open}
          onOpenChange={setOpen}
          analyticsEnabled={analyticsEnabled}
          onAnalyticsChange={setAnalyticsEnabled}
          onDeny={() => {
            setAnalyticsEnabled(false);
            setSaved("Analytics denied");
            setOpen(false);
          }}
          onAcceptAll={() => {
            setAnalyticsEnabled(true);
            setSaved("Analytics accepted");
            setOpen(false);
          }}
          onSave={() => {
            setSaved(
              analyticsEnabled ? "Analytics accepted" : "Analytics denied",
            );
            setOpen(false);
          }}
        />
      </div>
    );
  },
};
