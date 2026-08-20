import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@everr/ui/components/empty";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { BellOffIcon, SearchIcon } from "lucide-react";

const meta = {
  title: "Data/Empty",
  component: Empty,
  render: () => (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>No alerts firing</EmptyTitle>
        <EmptyDescription>
          Every rule in this project is healthy for the selected time range.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  ),
} satisfies Meta<typeof Empty>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithIconMedia: Story = {
  render: () => (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BellOffIcon />
        </EmptyMedia>
        <EmptyTitle>No alerts firing</EmptyTitle>
        <EmptyDescription>
          Everr checks your rules every 30 seconds.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  ),
};

export const WithPlainMedia: Story = {
  render: () => (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia>
          <SearchIcon className="size-8 text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>No services match this filter</EmptyTitle>
        <EmptyDescription>
          Remove a filter or widen the time range.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  ),
};

export const WithContentAction: Story = {
  render: () => (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BellOffIcon />
        </EmptyMedia>
        <EmptyTitle as="h2">No alert rules yet</EmptyTitle>
        <EmptyDescription>
          Alert rules are applied as code. See the{" "}
          <a href="#docs">alerting guide</a> to write your first one.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" variant="outline">
          Copy example YAML
        </Button>
        <EmptyDescription>
          Then run <code>everr apply ./alerts</code>.
        </EmptyDescription>
      </EmptyContent>
    </Empty>
  ),
};

export const TitleLevels: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(["div", "h2", "h3"] as const).map((as) => (
        <Empty key={as} className="border">
          <EmptyHeader>
            <EmptyTitle as={as}>Rendered as {as}</EmptyTitle>
            <EmptyDescription>
              The title element changes, the style stays the same.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ))}
    </div>
  ),
};
