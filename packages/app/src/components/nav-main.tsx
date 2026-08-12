import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@everr/ui/components/sidebar";
import { Link } from "@tanstack/react-router";
import type { NavGroup } from "@/lib/navigation";

export function NavMain({ groups }: { groups: NavGroup[] }) {
  return (
    <>
      {groups.map((group) => (
        <SidebarGroup key={group.label ?? "pinned"}>
          {group.label && (
            // When icon-collapsed the label stays in the DOM at opacity 0,
            // pulled up over the previous group's last item; without
            // pointer-events-none it swallows that item's clicks and hovers.
            <SidebarGroupLabel className="text-sidebar-foreground/50 text-[10px] font-medium uppercase tracking-[0.12em] group-data-[collapsible=icon]:pointer-events-none">
              {group.label}
            </SidebarGroupLabel>
          )}
          <SidebarMenu>
            {group.items.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  tooltip={item.title}
                  className="[&>svg]:text-sidebar-foreground/60 hover:[&>svg]:text-sidebar-accent-foreground data-active:[&>svg]:text-primary"
                  render={
                    <Link
                      to={item.url}
                      activeOptions={{ exact: item.url === "/" }}
                      activeProps={{ "data-active": true }}
                    />
                  }
                >
                  <item.icon />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </>
  );
}
