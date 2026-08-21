import { Badge } from "@everr/ui/components/badge";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AlertTriangleIcon, CheckIcon } from "lucide-react";

const meta = {
  title: "Data/Badge",
  component: Badge,
  args: { children: "Badge" },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Secondary: Story = {
  args: { variant: "secondary", children: "Secondary" },
};

export const Destructive: Story = {
  args: { variant: "destructive", children: "Firing" },
};

export const Outline: Story = {
  args: { variant: "outline", children: "checkout-api" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "Ghost" },
};

export const Link: Story = {
  args: { variant: "link", children: "View rule" },
};

export const DiffTones: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="added">Added</Badge>
      <Badge variant="changed">Changed</Badge>
      <Badge variant="conflict">Conflict</Badge>
      <Badge variant="removed">Removed</Badge>
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="added">
        <CheckIcon data-icon="inline-start" />
        Healthy
      </Badge>
      <Badge variant="destructive">
        <AlertTriangleIcon data-icon="inline-start" />3 firing
      </Badge>
    </div>
  ),
};

export const AsLink: Story = {
  args: {
    variant: "outline",
    children: "payments-worker",
    render: <a href="#services">payments-worker</a>,
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>default</Badge>
      <Badge variant="secondary">secondary</Badge>
      <Badge variant="destructive">destructive</Badge>
      <Badge variant="outline">outline</Badge>
      <Badge variant="ghost">ghost</Badge>
      <Badge variant="link">link</Badge>
      <Badge variant="added">added</Badge>
      <Badge variant="changed">changed</Badge>
      <Badge variant="conflict">conflict</Badge>
      <Badge variant="removed">removed</Badge>
    </div>
  ),
};
