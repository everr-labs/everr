import { Link } from "@tanstack/react-router";
import {
  ChartLine,
  Citrus,
  FlaskConical,
  GitBranch,
  GitFork,
} from "lucide-react";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const data = {
  user: {
    name: "John Doe",
    email: "john@example.com",
    avatar: "",
  },
  navMain: [
    {
      title: "CI/CD",
      url: "/dashboard",
      icon: GitBranch,
      isActive: true,
      items: [
        {
          title: "Overview",
          url: "/dashboard",
        },
        {
          title: "Runs",
          url: "/dashboard/runs",
        },
        {
          title: "Failures",
          url: "/dashboard/failures",
        },
      ],
    },
    {
      title: "Testing",
      url: "/dashboard/test-results",
      icon: FlaskConical,
      isActive: true,
      items: [
        {
          title: "Test Results",
          url: "/dashboard/test-results",
        },
        {
          title: "Flaky Tests",
          url: "/dashboard/flaky-tests",
        },
      ],
    },
    {
      title: "Insights",
      url: "/dashboard/analytics",
      icon: ChartLine,
      isActive: true,
      items: [
        {
          title: "Analytics",
          url: "/dashboard/analytics",
        },
        {
          title: "Cost Analysis",
          url: "/dashboard/cost-analysis",
        },
      ],
    },
    {
      title: "Repositories",
      url: "/dashboard/repos",
      icon: GitFork,
      items: [
        {
          title: "All Repositories",
          url: "/dashboard/repos",
        },
      ],
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/dashboard" />}>
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <Citrus className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Citric</span>
                <span className="truncate text-xs">CI/CD Observability</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
