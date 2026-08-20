import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@everr/ui/components/input-group";
import { Kbd } from "@everr/ui/components/kbd";
import { Label } from "@everr/ui/components/label";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ArrowUpIcon,
  CopyIcon,
  SearchIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import * as React from "react";

const meta = {
  title: "Controls/InputGroup",
  component: InputGroup,
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <InputGroup>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput placeholder="Search alerts" />
    </InputGroup>
  ),
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InlineEndAddon: Story = {
  render: () => (
    <InputGroup>
      <InputGroupInput placeholder="Search alerts" />
      <InputGroupAddon align="inline-end">
        <Kbd>/</Kbd>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const BothInlineAddons: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>https://</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="hooks.example.com/alerts" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Copy">
          <CopyIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const ButtonSizes: Story = {
  render: () => (
    <div className="grid gap-3">
      <InputGroup>
        <InputGroupInput placeholder="Extra small button" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="xs">Apply</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupInput placeholder="Small button" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="sm" variant="outline">
            Apply
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupInput placeholder="Icon buttons" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="Clear">
            <XIcon />
          </InputGroupButton>
          <InputGroupButton size="icon-sm" aria-label="Send">
            <SendIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  ),
};

export const BlockStartAddon: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon align="block-start" className="border-b">
        <InputGroupText>Filter expression</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="service.name = 'checkout-api'" />
    </InputGroup>
  ),
};

export const BlockEndAddon: Story = {
  render: () => (
    <InputGroup>
      <InputGroupInput placeholder="service.name = 'checkout-api'" />
      <InputGroupAddon align="block-end" className="border-t">
        <InputGroupText>Press Enter to run the query</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const WithTextarea: Story = {
  render: () => (
    <InputGroup>
      <InputGroupTextarea placeholder="Why are you silencing this alert?" />
      <InputGroupAddon align="block-end" className="justify-end">
        <InputGroupButton size="icon-sm" aria-label="Send">
          <ArrowUpIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const WithLabel: Story = {
  render: () => (
    <div className="grid gap-2">
      <Label htmlFor="query">Query</Label>
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput id="query" placeholder="Search alerts" />
      </InputGroup>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <InputGroup data-disabled="true">
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput placeholder="Search alerts" disabled />
    </InputGroup>
  ),
};

export const Invalid: Story = {
  render: () => (
    <div className="grid gap-2">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput aria-invalid defaultValue="service.name =" />
      </InputGroup>
      <p className="text-destructive text-xs">The expression is incomplete.</p>
    </div>
  ),
};

export const Controlled: Story = {
  render: () => {
    const [value, setValue] = React.useState("checkout");

    return (
      <div className="grid gap-2">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Search alerts"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear"
              onClick={() => setValue("")}
            >
              <XIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <p className="text-muted-foreground text-xs">
          Query: {value || "None"}
        </p>
      </div>
    );
  },
};
