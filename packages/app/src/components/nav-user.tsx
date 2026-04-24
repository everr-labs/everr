import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@everr/ui/components/sidebar";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import {
  BadgeCheck,
  Building2,
  Check,
  ChevronsUpDown,
  Download,
  LogOut,
  Users,
} from "lucide-react";
import { PLATFORMS, useDownloadUrl } from "@/lib/app-download";
import { authClient } from "@/lib/auth-client";

export function NavUser() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const { data: orgs } = authClient.useListOrganizations();
  const downloadUrl = useDownloadUrl(PLATFORMS[0].updaterTarget);
  const userRole = activeOrg?.members?.find(
    (m) => m.userId === session?.user?.id,
  )?.role;
  const isAdmin = userRole === "admin" || userRole === "owner";
  const hasMultipleOrgs = orgs && orgs.length > 1;

  const { isMobile } = useSidebar();

  async function handleSwitchOrg(orgId: string) {
    await authClient.organization.setActive({ organizationId: orgId });
    await queryClient.invalidateQueries();
    router.invalidate();
  }

  if (!session?.user) {
    return null;
  }

  const { user } = session;
  const nameParts = (user.name ?? "").split(" ");
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ");
  const fullName = user.name ?? user.email;

  const initials =
    (firstName.slice(0, 1) + lastName.slice(0, 1)).toUpperCase() || "?";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-xs font-medium">
              {user.image ? (
                <img
                  src={user.image}
                  alt={fullName}
                  className="size-full object-cover rounded-sm"
                />
              ) : (
                initials
              )}
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{fullName}</span>
              <span className="truncate text-xs">{user.email}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <div className="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-xs font-medium">
                {initials}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{fullName}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
            </div>
            <DropdownMenuSeparator />
            {hasMultipleOrgs && (
              <DropdownMenuGroup>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Building2 />
                    {activeOrg?.name ?? "Switch organization"}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {orgs.map((org) => (
                      <DropdownMenuItem
                        key={org.id}
                        onClick={() => void handleSwitchOrg(org.id)}
                      >
                        {org.id === activeOrg?.id ? (
                          <Check />
                        ) : (
                          <span className="size-4" />
                        )}
                        <span className="truncate">{org.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuGroup>
            )}
            <DropdownMenuGroup>
              <DropdownMenuItem render={<Link to="/account" />}>
                <BadgeCheck />
                Account
              </DropdownMenuItem>
              {isAdmin ? (
                <DropdownMenuItem render={<Link to="/users-management" />}>
                  <Users />
                  Users Management
                </DropdownMenuItem>
              ) : null}
              {downloadUrl ? (
                <DropdownMenuItem
                  render={
                    <a href={downloadUrl} download>
                      <Download />
                      Download App
                    </a>
                  }
                >
                  <Download />
                  Download App
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                void authClient.signOut({
                  fetchOptions: {
                    onSuccess: () => {
                      window.location.href = "/";
                    },
                  },
                })
              }
            >
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
