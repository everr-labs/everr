import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@everr/ui/components/sidebar";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ActivityIcon,
  BellIcon,
  LayoutDashboardIcon,
  ListIcon,
  PlusIcon,
  SettingsIcon,
  TriangleAlertIcon,
  WaypointsIcon,
} from "lucide-react";

const meta = {
  title: "Layout/Sidebar",
  component: Sidebar,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

const navigation = [
  { title: "Overview", icon: LayoutDashboardIcon },
  { title: "Logs", icon: ListIcon },
  { title: "Traces", icon: WaypointsIcon },
  { title: "Metrics", icon: ActivityIcon },
];

function Nav() {
  return (
    <>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="Everr">
              <ActivityIcon />
              <span>Everr</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarInput placeholder="Search" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Telemetry</SidebarGroupLabel>
          <SidebarGroupAction title="New view">
            <PlusIcon />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item, index) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={index === 0}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupLabel>Alerting</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Alerts">
                  <BellIcon />
                  <span>Alerts</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>7</SidebarMenuBadge>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton href="#" isActive>
                      <span>Firing</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton href="#" size="sm">
                      <span>Silences</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="SLOs">
                  <TriangleAlertIcon />
                  <span>SLOs</span>
                </SidebarMenuButton>
                <SidebarMenuAction showOnHover title="Add SLO">
                  <PlusIcon />
                </SidebarMenuAction>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Loading</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuSkeleton showIcon />
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuSkeleton showIcon />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton variant="outline" tooltip="Settings">
              <SettingsIcon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </>
  );
}

function Page({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <span className="font-medium">{title}</span>
      </div>
      <p className="text-muted-foreground">
        Toggle the sidebar with the trigger, the rail, or Cmd+B.
      </p>
    </div>
  );
}

export const Expanded: Story = {
  args: { collapsible: "icon" },
  render: (args) => (
    <SidebarProvider open className="h-[36rem] min-h-0">
      <Sidebar {...args}>
        <Nav />
      </Sidebar>
      <Page title="Expanded" />
    </SidebarProvider>
  ),
};

export const CollapsedToIcons: Story = {
  args: { collapsible: "icon" },
  render: (args) => (
    <SidebarProvider open={false} className="h-[36rem] min-h-0">
      <Sidebar {...args}>
        <Nav />
      </Sidebar>
      <Page title="Collapsed to icons" />
    </SidebarProvider>
  ),
};

export const CollapsedOffcanvas: Story = {
  args: { collapsible: "offcanvas" },
  render: (args) => (
    <SidebarProvider open={false} className="h-[36rem] min-h-0">
      <Sidebar {...args}>
        <Nav />
      </Sidebar>
      <Page title="Collapsed offcanvas" />
    </SidebarProvider>
  ),
};

export const NotCollapsible: Story = {
  args: { collapsible: "none" },
  render: (args) => (
    <SidebarProvider open className="h-[36rem] min-h-0">
      <Sidebar {...args}>
        <Nav />
      </Sidebar>
      <Page title="Always open" />
    </SidebarProvider>
  ),
};

export const FloatingVariant: Story = {
  args: { variant: "floating", collapsible: "icon" },
  render: (args) => (
    <SidebarProvider open className="h-[36rem] min-h-0">
      <Sidebar {...args}>
        <Nav />
      </Sidebar>
      <Page title="Floating" />
    </SidebarProvider>
  ),
};

export const InsetVariant: Story = {
  args: { variant: "inset", collapsible: "icon" },
  render: (args) => (
    <SidebarProvider open className="h-[36rem] min-h-0">
      <Sidebar {...args}>
        <Nav />
      </Sidebar>
      <SidebarInset>
        <Page title="Inset" />
      </SidebarInset>
    </SidebarProvider>
  ),
};

export const RightSide: Story = {
  args: { side: "right", collapsible: "icon" },
  render: (args) => (
    <SidebarProvider open className="h-[36rem] min-h-0">
      <Page title="Right side" />
      <Sidebar {...args}>
        <Nav />
      </Sidebar>
    </SidebarProvider>
  ),
};
