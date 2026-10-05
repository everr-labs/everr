import { EverrLogoMark } from "@everr/ui/components/everr-logo";
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
              <EverrLogoMark className="size-8!" aria-hidden="true" />
              <div className="grid flex-1 text-left text-sm leading-tight transition-opacity duration-200 ease-sidebar motion-reduce:transition-none group-data-[collapsible=icon]:opacity-0">
                <span className="overflow-hidden whitespace-nowrap font-semibold">
                  everr
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
