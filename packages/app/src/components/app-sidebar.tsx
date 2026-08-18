import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@everr/ui/components/sidebar";
import { Link } from "@tanstack/react-router";
import { Citrus } from "lucide-react";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { navGroups } from "@/lib/navigation";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />}>
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <Citrus />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight transition-opacity duration-200 ease-sidebar motion-reduce:transition-none group-data-[collapsible=icon]:opacity-0">
                <span className="overflow-hidden whitespace-nowrap font-semibold">
                  Everr
                </span>
                <span className="overflow-hidden whitespace-nowrap text-xs">
                  Observability made simple
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={navGroups} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
