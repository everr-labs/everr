import { cn } from "@everr/ui/lib/utils";
import { kickerClass } from "@everr/ui/lib/typography";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@everr/ui/components/sidebar";
import { Link, type RegisteredRouter } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Fragment } from "react";

/** `TPath` lets an app hold its own groups to the paths its router has. */
type NavItem<TPath extends string = string> = {
  title: string;
  url: TPath;
  icon: LucideIcon;
  /** Light the item up only on its own URL, not on the URLs nested under it.
   *  A section index such as `/alerts` needs this: without it it stays active
   *  on every sibling below it and two items light up at once. */
  exact?: boolean;
};

export type NavGroup<TPath extends string = string> = {
  label?: string;
  /** Sets `--nav-accent`, the section colour its icons wear in the sidebar,
   *  the command bar, the breadcrumb and empty states. One per group rather
   *  than per item, so the colour says which section you are in. A whole
   *  class, so Tailwind finds it here. */
  accent: string;
  items: NavItem<TPath>[];
};

/** The sidebar destination a pathname belongs to: the item with the longest
 *  URL that prefixes it, so `/alerts/silences` resolves to Silences rather
 *  than Triage. Home matches only `/` itself. */
export function findNavSection(
  groups: readonly NavGroup[],
  pathname: string,
): { group: NavGroup; item: NavItem } | undefined {
  let best: { group: NavGroup; item: NavItem } | undefined;
  for (const group of groups) {
    for (const item of group.items) {
      const matches =
        item.url === "/"
          ? pathname === "/"
          : pathname === item.url || pathname.startsWith(`${item.url}/`);
      if (matches && (!best || item.url.length > best.item.url.length)) best = { group, item };
    }
  }
  return best;
}

export function NavMain({ groups }: { groups: readonly NavGroup[] }) {
  return (
    <>
      {groups.map((group, groupIndex) => (
        // The divider is a sibling of the groups, not a child of one: inside
        // a group it would sit below that group's top padding and end up
        // nearer the icon under it than the one over it.
        <Fragment key={group.label ?? "pinned"}>
          {groupIndex > 0 && <CollapsedGroupDivider />}
          <SidebarGroup className={group.accent}>
            {group.label && (
              <SidebarGroupLabel
                className={cn(kickerClass, "group-data-[collapsible=icon]:pointer-events-none")}
              >
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarMenu>
              {group.items.map((item) => (
                <NavLink
                  key={item.title}
                  title={item.title}
                  to={item.url}
                  icon={item.icon}
                  exact={item.exact}
                  section={group.label}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </Fragment>
      ))}
    </>
  );
}

/**
 * One sidebar destination. It is what the nav groups render, and what an app
 * renders in its sidebar footer so a link there looks and behaves like the
 * ones above it. It wears the `--nav-accent` of the group it sits in, so
 * outside a group the parent sets it.
 */
export function ShellNavLink(
  props: Omit<NavLinkProps, "to"> & { to: keyof RegisteredRouter["routesByPath"] },
) {
  return <NavLink {...props} />;
}

type NavLinkProps = {
  title: string;
  to: string;
  icon: LucideIcon;
  exact?: boolean;
  /** The group label the collapsed rail's tooltip shows above the title. */
  section?: string;
};

function NavLink({ title, to, icon: Icon, exact, section }: NavLinkProps) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={title}
        tooltipSection={section}
        className="[&>svg]:text-(--nav-accent)/75 [&>svg]:transition-colors [&>svg]:duration-200 [&>svg]:ease-sidebar motion-reduce:[&>svg]:transition-none hover:[&>svg]:text-(--nav-accent) data-active:bg-(--nav-accent)/12 data-active:text-white data-active:hover:bg-(--nav-accent)/16 data-active:[&>svg]:text-(--nav-accent)"
        render={
          <Link
            to={to}
            // `includeSearch: false`: search params such as the
            // `?alert=` detail panel on Triage are not a different
            // destination, and an exact match would treat them as
            // one and light nothing up.
            activeOptions={{
              exact: exact ?? false,
              includeSearch: false,
            }}
            activeProps={{ "data-active": true }}
          />
        }
      >
        <Icon />
        <span>{title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
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
