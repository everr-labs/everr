import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Separator } from "@everr/ui/components/separator";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  title: "Layout/Card",
  component: Card,
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Card {...args} className="w-80">
      <CardHeader>
        <CardTitle>Checkout latency</CardTitle>
        <CardDescription>p95 over the last 24 hours</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-medium tabular-nums">412 ms</p>
      </CardContent>
    </Card>
  ),
};

export const WithAction: Story = {
  render: (args) => (
    <Card {...args} className="w-80">
      <CardHeader>
        <CardTitle>Error budget</CardTitle>
        <CardDescription>28 days remaining in the window</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm">
            Details
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">61% of the budget is left.</p>
      </CardContent>
    </Card>
  ),
};

export const WithFooter: Story = {
  render: (args) => (
    <Card {...args} className="w-80">
      <CardHeader>
        <CardTitle>Deploy 4f21ac</CardTitle>
        <CardDescription>Promoted 12 minutes ago</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">
          All checks passed on the release pipeline.
        </p>
      </CardContent>
      <Separator />
      <CardFooter className="justify-end gap-2 pt-3">
        <Button variant="ghost" size="sm">
          Roll back
        </Button>
        <Button size="sm">Open run</Button>
      </CardFooter>
    </Card>
  ),
};

export const Small: Story = {
  args: { size: "sm" },
  render: (args) => (
    <Card {...args} className="w-64">
      <CardHeader>
        <CardTitle>Ingest rate</CardTitle>
        <CardDescription>Spans per second</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-medium tabular-nums">18.4k</p>
      </CardContent>
    </Card>
  ),
};

export const FlushContent: Story = {
  args: { inset: "flush-content" },
  render: (args) => (
    <Card {...args} className="w-80">
      <CardHeader>
        <CardTitle>Recent alerts</CardTitle>
        <CardDescription>Firing instances by rule</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-border divide-y border-t">
          {["Checkout p95", "Queue depth", "Auth error rate"].map((rule) => (
            <li key={rule} className="px-3 py-2">
              {rule}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  ),
};
