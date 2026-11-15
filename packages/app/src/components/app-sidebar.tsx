import { layouts } from "@composition/layouts";
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
  useSidebar,
} from "@everr/ui/components/sidebar";
import { Link } from "@tanstack/react-router";
import { NavMain } from "#app/components/nav-main.tsx";
import { useOnNavigate } from "#app/hooks/use-on-navigate.ts";
import { navGroups } from "#app/lib/navigation.ts";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  // On a phone the sidebar is a sheet over the page, which a navigation from
  // it, or from the user menu portaled outside it, should leave.
  const { setOpenMobile } = useSidebar();
  useOnNavigate(() => setOpenMobile(false));
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />}>
              <EverrLogoMark className="size-8!" aria-hidden="true" />
              <div className="grid flex-1 text-left text-sm leading-tight transition-opacity duration-200 ease-sidebar motion-reduce:transition-none group-data-[collapsible=icon]:opacity-0">
                <span className="overflow-hidden whitespace-nowrap font-semibold text-white">
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
        <layouts.UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
