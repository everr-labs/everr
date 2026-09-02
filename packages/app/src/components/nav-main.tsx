import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@everr/ui/components/sidebar";
import { Link } from "@tanstack/react-router";
import { Fragment } from "react";
import type { NavGroup } from "@/lib/navigation";

export function NavMain({ groups }: { groups: NavGroup[] }) {
  return (
    <>
      {groups.map((group, groupIndex) => (
        // The divider is a sibling of the groups, not a child of one: inside
        // a group it would sit below that group's top padding and end up
        // nearer the icon under it than the one over it.
        <Fragment key={group.label ?? "pinned"}>
          {groupIndex > 0 && <CollapsedGroupDivider />}
          <SidebarGroup>
            {group.label && (
              <SidebarGroupLabel className="text-sidebar-foreground/50 text-[10px] font-medium uppercase tracking-[0.12em] group-data-[collapsible=icon]:pointer-events-none">
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    tooltipSection={group.label}
                    className="[&>svg]:text-sidebar-foreground/60 hover:[&>svg]:text-sidebar-accent-foreground data-active:[&>svg]:text-primary"
                    render={
                      <Link
                        to={item.url}
                        // `includeSearch: false`: search params such as the
                        // `?alert=` detail panel on Triage are not a different
                        // destination, and an exact match would treat them as
                        // one and light nothing up.
                        activeOptions={{
                          exact: item.exact ?? false,
                          includeSearch: false,
                        }}
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
        </Fragment>
      ))}
    </>
  );
}

/**
 * Collapsing the rail hides every group label, which leaves the icons running
 * together as one undifferentiated column. This hairline stands in for the
 * label: it is the only thing separating the sections at that width, so it
 * exists only there and takes no height when the labels are back. It sits in
 * the gap between two groups so the icons above and below it are equally far
 * from the line.
 */
function CollapsedGroupDivider() {
  return (
    <div
      aria-hidden
      className="ease-sidebar flex h-0 items-center justify-center overflow-hidden opacity-0 transition-[height,opacity] duration-200 group-data-[collapsible=icon]:h-3 group-data-[collapsible=icon]:opacity-100 motion-reduce:transition-none"
    >
      <span className="bg-sidebar-border h-px w-5" />
    </div>
  );
}
