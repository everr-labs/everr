import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@everr/ui/components/tabs";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActivityIcon, ListIcon, WaypointsIcon } from "lucide-react";

const meta = {
  title: "Layout/Tabs",
  component: Tabs,
  args: { defaultValue: "logs" },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

const panels = (
  <>
    <TabsContent value="logs">
      Structured log lines for the request.
    </TabsContent>
    <TabsContent value="traces">
      The span waterfall for the request.
    </TabsContent>
    <TabsContent value="metrics">
      Rate, errors, and duration series.
    </TabsContent>
  </>
);

export const Default: Story = {
  render: (args) => (
    <Tabs {...args} className="w-96">
      <TabsList>
        <TabsTrigger value="logs">Logs</TabsTrigger>
        <TabsTrigger value="traces">Traces</TabsTrigger>
        <TabsTrigger value="metrics">Metrics</TabsTrigger>
      </TabsList>
      {panels}
    </Tabs>
  ),
};

export const LineVariant: Story = {
  render: (args) => (
    <Tabs {...args} className="w-96">
      <TabsList variant="line">
        <TabsTrigger value="logs">Logs</TabsTrigger>
        <TabsTrigger value="traces">Traces</TabsTrigger>
        <TabsTrigger value="metrics">Metrics</TabsTrigger>
      </TabsList>
      {panels}
    </Tabs>
  ),
};

export const WithIcons: Story = {
  render: (args) => (
    <Tabs {...args} className="w-96">
      <TabsList>
        <TabsTrigger value="logs">
          <ListIcon />
          Logs
        </TabsTrigger>
        <TabsTrigger value="traces">
          <WaypointsIcon />
          Traces
        </TabsTrigger>
        <TabsTrigger value="metrics">
          <ActivityIcon />
          Metrics
        </TabsTrigger>
      </TabsList>
      {panels}
    </Tabs>
  ),
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
  render: (args) => (
    <Tabs {...args} className="w-96">
      <TabsList>
        <TabsTrigger value="logs">Logs</TabsTrigger>
        <TabsTrigger value="traces">Traces</TabsTrigger>
        <TabsTrigger value="metrics">Metrics</TabsTrigger>
      </TabsList>
      {panels}
    </Tabs>
  ),
};

export const DisabledTab: Story = {
  render: (args) => (
    <Tabs {...args} className="w-96">
      <TabsList>
        <TabsTrigger value="logs">Logs</TabsTrigger>
        <TabsTrigger value="traces">Traces</TabsTrigger>
        <TabsTrigger value="metrics" disabled>
          Metrics
        </TabsTrigger>
      </TabsList>
      {panels}
    </Tabs>
  ),
};
