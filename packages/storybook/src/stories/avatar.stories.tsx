import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@everr/ui/components/avatar";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CheckIcon } from "lucide-react";

const portrait = (hue: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="hsl(${hue} 60% 45%)"/><circle cx="40" cy="32" r="14" fill="hsl(${hue} 60% 80%)"/><circle cx="40" cy="78" r="26" fill="hsl(${hue} 60% 80%)"/></svg>`,
  )}`;

const meta = {
  title: "Data/Avatar",
  component: Avatar,
  render: (args) => (
    <Avatar {...args}>
      <AvatarImage src={portrait(210)} alt="Ada Lovelace" />
      <AvatarFallback>AL</AvatarFallback>
    </Avatar>
  ),
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-3">
      {(["xs", "sm", "default", "lg"] as const).map((size) => (
        <Avatar key={size} size={size}>
          <AvatarImage src={portrait(160)} alt="Grace Hopper" />
          <AvatarFallback>GH</AvatarFallback>
        </Avatar>
      ))}
    </div>
  ),
};

export const Fallback: Story = {
  render: () => (
    <div className="flex items-end gap-3">
      <Avatar size="sm">
        <AvatarFallback>GR</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>GR</AvatarFallback>
      </Avatar>
      <Avatar size="lg">
        <AvatarFallback>GR</AvatarFallback>
      </Avatar>
    </div>
  ),
};

export const BrokenImage: Story = {
  render: () => (
    <Avatar>
      <AvatarImage src="/missing-portrait.png" alt="Missing" />
      <AvatarFallback>MP</AvatarFallback>
    </Avatar>
  ),
};

export const WithBadge: Story = {
  render: () => (
    <div className="flex items-end gap-3">
      <Avatar size="sm">
        <AvatarImage src={portrait(120)} alt="Online user" />
        <AvatarFallback>ON</AvatarFallback>
        <AvatarBadge className="bg-emerald-500" />
      </Avatar>
      <Avatar>
        <AvatarImage src={portrait(120)} alt="Online user" />
        <AvatarFallback>ON</AvatarFallback>
        <AvatarBadge className="bg-emerald-500" />
      </Avatar>
      <Avatar size="lg">
        <AvatarImage src={portrait(120)} alt="Verified user" />
        <AvatarFallback>VU</AvatarFallback>
        <AvatarBadge>
          <CheckIcon />
        </AvatarBadge>
      </Avatar>
    </div>
  ),
};

export const Group: Story = {
  render: () => (
    <AvatarGroup>
      {[10, 90, 200, 300].map((hue) => (
        <Avatar key={hue}>
          <AvatarImage src={portrait(hue)} alt={`On-call engineer ${hue}`} />
          <AvatarFallback>EN</AvatarFallback>
        </Avatar>
      ))}
      <AvatarGroupCount>+7</AvatarGroupCount>
    </AvatarGroup>
  ),
};

export const GroupSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(["sm", "default", "lg"] as const).map((size) => (
        <AvatarGroup key={size}>
          {[20, 140, 260].map((hue) => (
            <Avatar key={hue} size={size}>
              <AvatarImage src={portrait(hue)} alt="Team member" />
              <AvatarFallback>TM</AvatarFallback>
            </Avatar>
          ))}
          <AvatarGroupCount>+3</AvatarGroupCount>
        </AvatarGroup>
      ))}
    </div>
  ),
};
