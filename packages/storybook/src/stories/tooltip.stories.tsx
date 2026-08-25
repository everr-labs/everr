import { Button } from "@everr/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { InfoIcon } from "lucide-react";

const meta = {
  title: "Overlays/Tooltip",
  component: Tooltip,
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex min-h-40 items-center justify-center">
      <Tooltip open>
        <TooltipTrigger render={<Button variant="outline" />}>
          Hover me
        </TooltipTrigger>
        <TooltipContent>Refresh every 30 seconds</TooltipContent>
      </Tooltip>
    </div>
  ),
};

export const Sides: Story = {
  render: () => (
    <div className="grid min-h-96 grid-cols-2 place-items-center gap-10">
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <Tooltip key={side} open>
          <TooltipTrigger render={<Button variant="outline" />}>
            {side}
          </TooltipTrigger>
          <TooltipContent side={side}>Placed on the {side}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  ),
};

export const OnIconButton: Story = {
  render: () => (
    <div className="flex min-h-40 items-center justify-center">
      <Tooltip open>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" />}>
          <InfoIcon />
          <span className="sr-only">About this metric</span>
        </TooltipTrigger>
        <TooltipContent>
          The rate counts every request that returned 5xx.
        </TooltipContent>
      </Tooltip>
    </div>
  ),
};

export const WithDelay: Story = {
  render: () => (
    <TooltipProvider delay={600}>
      <div className="flex min-h-40 items-center justify-center">
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" />}>
            Hover and wait
          </TooltipTrigger>
          <TooltipContent>
            The provider delays this tooltip 600ms
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  ),
};
