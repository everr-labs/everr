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
import { Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { NavMain } from "#app/components/nav-main.tsx";
import { navGroups } from "#app/lib/navigation.ts";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  useCloseOnNavigate();
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />}>
              <EverrLogoMark className="size-8!" aria-hidden="true" />
              <div className="grid flex-1 text-left text-sm leading-tight transition-opacity duration-200 ease-sidebar motion-reduce:transition-none group-data-[collapsible=icon]:opacity-0">
                <span className="overflow-hidden whitespace-nowrap font-semibold">everr</span>
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

/**
 * On a phone the sidebar is a sheet over the page, and a sheet left open after
 * a navigation hides the page it went to. Listens to the router rather than to
 * the sidebar's links, so the user menu's items (portaled outside the sheet)
 * and a tap on the page already open close it too. Closing starts with the
 * navigation, not after its loaders, so the tap answers at once.
 */
function useCloseOnNavigate() {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  useEffect(
    () => router.subscribe("onBeforeNavigate", () => setOpenMobile(false)),
    [router, setOpenMobile],
  );
}
