import { Button } from "@everr/ui/components/button";
import { Kbd } from "@everr/ui/components/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowUpIcon, CommandIcon } from "lucide-react";

const meta = {
  title: "Controls/Kbd",
  component: Kbd,
  args: { children: "K" },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Combination: Story = {
  render: () => (
    <div className="flex items-center gap-1">
      <Kbd>
        <CommandIcon />
      </Kbd>
      <Kbd>K</Kbd>
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <Kbd>
      <ArrowUpIcon />
    </Kbd>
  ),
};

export const WordKeys: Story = {
  render: () => (
    <div className="flex items-center gap-1">
      <Kbd>Shift</Kbd>
      <Kbd>Enter</Kbd>
      <Kbd>Esc</Kbd>
    </div>
  ),
};

export const InText: Story = {
  render: () => (
    <p className="text-muted-foreground text-xs">
      Press <Kbd>/</Kbd> to search, then <Kbd>Enter</Kbd> to open the result.
    </p>
  ),
};

export const InTooltip: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline">Search</Button>} />
      <TooltipContent className="flex items-center gap-2">
        Open the search
        <Kbd>
          <CommandIcon />
        </Kbd>
        <Kbd>K</Kbd>
      </TooltipContent>
    </Tooltip>
  ),
};
