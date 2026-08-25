import { Button } from "@everr/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@everr/ui/components/collapsible";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronsUpDownIcon } from "lucide-react";
import { useState } from "react";

const meta = {
  title: "Layout/Collapsible",
  component: Collapsible,
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

const attributes = [
  "service.name = checkout-api",
  "deployment.environment = production",
  "http.route = /cart/checkout",
];

export const Default: Story = {
  render: (args) => (
    <Collapsible {...args} className="w-80">
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between"
          />
        }
      >
        Resource attributes
        <ChevronsUpDownIcon />
      </CollapsibleTrigger>
      <CollapsibleContent className="text-muted-foreground grid gap-1 px-2 pt-2 font-mono">
        {attributes.map((attribute) => (
          <span key={attribute}>{attribute}</span>
        ))}
      </CollapsibleContent>
    </Collapsible>
  ),
};

export const OpenByDefault: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <Collapsible {...args} className="w-80">
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between"
          />
        }
      >
        Resource attributes
        <ChevronsUpDownIcon />
      </CollapsibleTrigger>
      <CollapsibleContent className="text-muted-foreground grid gap-1 px-2 pt-2 font-mono">
        {attributes.map((attribute) => (
          <span key={attribute}>{attribute}</span>
        ))}
      </CollapsibleContent>
    </Collapsible>
  ),
};

export const Controlled: Story = {
  render: function Controlled(args) {
    const [open, setOpen] = useState(false);
    return (
      <div className="w-80 grid gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Show"} attributes
        </Button>
        <Collapsible {...args} open={open} onOpenChange={setOpen}>
          <CollapsibleContent className="text-muted-foreground grid gap-1 font-mono">
            {attributes.map((attribute) => (
              <span key={attribute}>{attribute}</span>
            ))}
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  render: (args) => (
    <Collapsible {...args} className="w-80">
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between"
          />
        }
      >
        Resource attributes
        <ChevronsUpDownIcon />
      </CollapsibleTrigger>
      <CollapsibleContent className="text-muted-foreground px-2 pt-2">
        Not reachable while disabled.
      </CollapsibleContent>
    </Collapsible>
  ),
};
