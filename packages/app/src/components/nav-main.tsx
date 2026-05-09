import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@everr/ui/components/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@everr/ui/components/sidebar";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { NavItem } from "@/lib/navigation";

function NavItemFlyout({ item }: { item: NavItem }) {
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger
          openOnHover
          delay={80}
          closeDelay={120}
          render={<SidebarMenuButton />}
        >
          {item.icon && <item.icon />}
          <span>{item.title}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          sideOffset={12}
          className="min-w-40"
        >
          <div className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
            {item.title}
          </div>
          {item.items?.map((subItem) => (
            <DropdownMenuLinkItem
              key={subItem.title}
              render={
                <Link
                  to={subItem.url}
                  activeOptions={{ exact: subItem.url === "/" }}
                  activeProps={{ "data-active": true }}
                />
              }
            >
              {subItem.title}
            </DropdownMenuLinkItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function NavDirectItem({ item }: { item: NavItem }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={item.title}
        render={
          <Link
            to={item.url}
            activeOptions={{ exact: item.url === "/" }}
            activeProps={{ "data-active": true }}
          />
        }
      >
        {item.icon && <item.icon />}
        <span>{item.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function NavMain({ items }: { items: NavItem[] }) {
  const { state, isMobile } = useSidebar();
  const isIconOnly = state === "collapsed" && !isMobile;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) =>
          !item.items?.length ? (
            <NavDirectItem key={item.title} item={item} />
          ) : isIconOnly ? (
            <NavItemFlyout key={item.title} item={item} />
          ) : (
            <Collapsible
              key={item.title}
              defaultOpen={item.isActive}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger
                  render={<SidebarMenuButton tooltip={item.title} />}
                >
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                  <ChevronRight className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90" />
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items?.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <SidebarMenuSubButton
                          render={
                            <Link
                              to={subItem.url}
                              activeOptions={{
                                exact: subItem.url === "/",
                              }}
                              activeProps={{ "data-active": true }}
                            />
                          }
                        >
                          <span>{subItem.title}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          ),
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
