import {
  OptionCombobox,
  type OptionComboboxItem,
} from "@everr/ui/components/option-combobox";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MailIcon, WebhookIcon } from "lucide-react";
import { useState } from "react";

const channelTypes: OptionComboboxItem[] = [
  {
    value: "webhook",
    label: "Webhook",
    description: "Send alerts to an HTTP endpoint.",
    icon: WebhookIcon,
  },
  {
    value: "email",
    label: "Email",
    description: "Send alerts to an email address.",
    icon: MailIcon,
  },
];

/** Grouped under their project, with the path as menu-only supporting copy. */
const rules: OptionComboboxItem[] = [
  ["default", "cloud-query-system-errors", "Cloud query system errors"],
  ["default", "collector-oom", "Collector pod memory spike"],
  ["default", "eventloop-delay", "Node.js event loop delay"],
  ["demo", "demo-always-firing", "Always firing (demo)"],
  ["demo", "demo-flapping", "Flapping (demo)"],
].map(([project, slug, name]) => ({
  value: `${project}/${slug}`,
  label: name,
  description: (
    <span className="font-mono">
      {project}/{slug}
    </span>
  ),
  group: project,
}));

function StatefulCombobox({
  initialValue = null,
  ...props
}: Omit<Parameters<typeof OptionCombobox>[0], "value" | "onChange"> & {
  initialValue?: string | null;
}) {
  const [value, setValue] = useState<string | null>(initialValue);
  return <OptionCombobox {...props} value={value} onChange={setValue} />;
}

const meta = {
  title: "Data/OptionCombobox",
  component: OptionCombobox,
  args: {
    label: "Channel type",
    options: channelTypes,
    value: "webhook",
    onChange: () => {},
  },
  render: ({ value, onChange, ...args }) => (
    <div className="h-72 w-72">
      <StatefulCombobox {...args} initialValue={value} />
    </div>
  ),
} satisfies Meta<typeof OptionCombobox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Placeholder: Story = {
  args: { value: null, placeholder: "Pick a channel type" },
};

export const Grouped: Story = {
  args: {
    label: "Rule",
    options: rules,
    value: null,
    placeholder: "Choose a rule",
  },
};

export const Searchable: Story = {
  args: {
    label: "Rule",
    options: rules,
    value: null,
    placeholder: "Choose a rule",
    searchable: true,
    searchPlaceholder: "Search rules…",
    emptyMessage: "No rule matches.",
  },
};

export const Disabled: Story = {
  args: { disabled: true, placeholder: "Loading…", value: null },
};
