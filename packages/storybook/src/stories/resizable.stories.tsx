import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@everr/ui/components/resizable";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  title: "Layout/Resizable",
  component: ResizablePanelGroup,
  args: { orientation: "horizontal" },
} satisfies Meta<typeof ResizablePanelGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

function Pane({ label }: { label: string }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center p-3">
      {label}
    </div>
  );
}

export const Horizontal: Story = {
  render: (args) => (
    <div className="h-64 w-[36rem] overflow-hidden rounded-lg border">
      <ResizablePanelGroup {...args}>
        <ResizablePanel defaultSize={35}>
          <Pane label="Span list" />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel>
          <Pane label="Waterfall" />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  ),
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
  render: (args) => (
    <div className="h-64 w-[36rem] overflow-hidden rounded-lg border">
      <ResizablePanelGroup {...args}>
        <ResizablePanel defaultSize={60}>
          <Pane label="Query results" />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel>
          <Pane label="Row detail" />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  ),
};

export const WithHandleGrip: Story = {
  render: (args) => (
    <div className="h-64 w-[36rem] overflow-hidden rounded-lg border">
      <ResizablePanelGroup {...args}>
        <ResizablePanel defaultSize={50}>
          <Pane label="Left" />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel>
          <Pane label="Right" />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  ),
};

export const ThreePanels: Story = {
  render: (args) => (
    <div className="h-64 w-[36rem] overflow-hidden rounded-lg border">
      <ResizablePanelGroup {...args}>
        <ResizablePanel defaultSize={25} minSize={15}>
          <Pane label="Filters" />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={45}>
          <Pane label="Results" />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel minSize={15}>
          <Pane label="Detail" />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  ),
};

export const NestedGroups: Story = {
  render: (args) => (
    <div className="h-64 w-[36rem] overflow-hidden rounded-lg border">
      <ResizablePanelGroup {...args}>
        <ResizablePanel defaultSize={35}>
          <Pane label="Services" />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel>
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize={55}>
              <Pane label="Chart" />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel>
              <Pane label="Table" />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  ),
};

export const CollapsiblePanel: Story = {
  render: (args) => (
    <div className="h-64 w-[36rem] overflow-hidden rounded-lg border">
      <ResizablePanelGroup {...args}>
        <ResizablePanel collapsible collapsedSize={0} minSize={20}>
          <Pane label="Drag me shut" />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel>
          <Pane label="Detail" />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  ),
};
