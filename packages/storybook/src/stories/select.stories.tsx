import { Label } from "@everr/ui/components/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActivityIcon, BellIcon, ShieldIcon } from "lucide-react";
import * as React from "react";

const meta = {
  title: "Controls/Select",
  component: Select,
  render: () => (
    <Select>
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Pick a severity" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="page">Page</SelectItem>
          <SelectItem value="ticket">Ticket</SelectItem>
          <SelectItem value="info">Info</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Select defaultValue="page">
        <SelectTrigger size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="page">Page</SelectItem>
          <SelectItem value="ticket">Ticket</SelectItem>
        </SelectContent>
      </Select>
      <Select defaultValue="page">
        <SelectTrigger size="default">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="page">Page</SelectItem>
          <SelectItem value="ticket">Ticket</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
};

export const WithLabel: Story = {
  render: () => (
    <div className="grid w-56 gap-2">
      <Label htmlFor="severity">Severity</Label>
      <Select defaultValue="ticket">
        <SelectTrigger id="severity" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="page">Page</SelectItem>
          <SelectItem value="ticket">Ticket</SelectItem>
          <SelectItem value="info">Info</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
};

export const GroupsAndSeparator: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-64">
        <SelectValue placeholder="Pick a signal" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Availability</SelectLabel>
          <SelectItem value="uptime">Uptime</SelectItem>
          <SelectItem value="error-rate">Error rate</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Latency</SelectLabel>
          <SelectItem value="p95">p95 latency</SelectItem>
          <SelectItem value="p99">p99 latency</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <Select defaultValue="alerts">
      <SelectTrigger className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="alerts">
          <BellIcon />
          Alerts
        </SelectItem>
        <SelectItem value="slos">
          <ActivityIcon />
          SLOs
        </SelectItem>
        <SelectItem value="silences">
          <ShieldIcon />
          Silences
        </SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const DisabledItem: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Pick a destination" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="email">Email</SelectItem>
        <SelectItem value="slack" disabled>
          Slack (not connected)
        </SelectItem>
        <SelectItem value="webhook">Webhook</SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const DisabledTrigger: Story = {
  render: () => (
    <Select defaultValue="page" disabled>
      <SelectTrigger className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="page">Page</SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const Invalid: Story = {
  render: () => (
    <div className="grid w-56 gap-2">
      <Select>
        <SelectTrigger aria-invalid className="w-full">
          <SelectValue placeholder="Pick a severity" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="page">Page</SelectItem>
          <SelectItem value="ticket">Ticket</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-destructive text-xs">Select a severity.</p>
    </div>
  ),
};

export const Scrollable: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Pick a service" />
      </SelectTrigger>
      <SelectContent className="max-h-48" alignItemWithTrigger={false}>
        {Array.from({ length: 30 }, (_, index) => (
          <SelectItem key={index} value={`service-${index}`}>
            service-{index}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
};

export const Controlled: Story = {
  render: () => {
    const [value, setValue] = React.useState<unknown>("ticket");

    return (
      <div className="grid w-56 gap-2">
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="page">Page</SelectItem>
            <SelectItem value="ticket">Ticket</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Selected: {String(value)}
        </p>
      </div>
    );
  },
};
