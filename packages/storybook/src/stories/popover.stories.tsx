import { Button } from "@everr/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@everr/ui/components/popover";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  title: "Overlays/Popover",
  component: Popover,
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex min-h-72 items-center justify-center">
      <Popover defaultOpen>
        <PopoverTrigger render={<Button variant="outline" />}>
          Open popover
        </PopoverTrigger>
        <PopoverContent>
          <PopoverHeader>
            <PopoverTitle>Retention</PopoverTitle>
            <PopoverDescription>
              Traces stay for 7 days. Metrics stay for 90 days.
            </PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>
    </div>
  ),
};

export const Sides: Story = {
  render: () => (
    <div className="grid min-h-96 grid-cols-2 place-items-center gap-8">
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <Popover key={side} defaultOpen>
          <PopoverTrigger render={<Button variant="outline" />}>
            {side}
          </PopoverTrigger>
          <PopoverContent side={side} className="w-48">
            <PopoverHeader>
              <PopoverTitle>Side {side}</PopoverTitle>
              <PopoverDescription>
                The popup is placed on the {side} of the trigger.
              </PopoverDescription>
            </PopoverHeader>
          </PopoverContent>
        </Popover>
      ))}
    </div>
  ),
};

export const AlignedStart: Story = {
  render: () => (
    <div className="flex min-h-72 items-center justify-center">
      <Popover defaultOpen>
        <PopoverTrigger render={<Button variant="outline" />}>
          Aligned to start
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8}>
          <PopoverHeader>
            <PopoverTitle>Alignment</PopoverTitle>
            <PopoverDescription>
              The popup edge follows the start edge of the trigger.
            </PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>
    </div>
  ),
};

export const WithActions: Story = {
  render: () => (
    <div className="flex min-h-72 items-center justify-center">
      <Popover defaultOpen>
        <PopoverTrigger render={<Button variant="outline" />}>
          Silence rule
        </PopoverTrigger>
        <PopoverContent>
          <PopoverHeader>
            <PopoverTitle>Silence for 1 hour?</PopoverTitle>
            <PopoverDescription>
              The rule keeps evaluating, but it sends no notification.
            </PopoverDescription>
          </PopoverHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm">
              Cancel
            </Button>
            <Button size="sm">Silence</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  ),
};
