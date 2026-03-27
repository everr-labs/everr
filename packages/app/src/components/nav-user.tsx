import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@everr/ui/components/sidebar";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import {
  BadgeCheck,
  ChevronsUpDown,
  Download,
  LogOut,
  Users,
} from "lucide-react";
import { getDownloadUrl, PLATFORMS } from "@/lib/app-download";

export function NavUser() {
  const { user, roles, signOut } = useAuth();
  const isAdmin = roles?.includes("admin") === true;

  const { isMobile } = useSidebar();

  if (!user) {
    return null;
  }

  const firstName = user.firstName ?? "";
  const lastName = user.lastName ?? "";
  const fullName = `${firstName} ${lastName}`;

  const initials = firstName.slice(0, 1) + lastName.slice(0, 1);

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
              {user.profilePictureUrl ? (
                <img
                  src={user.profilePictureUrl}
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
              <DropdownMenuItem
                render={
                  <a
                    href={getDownloadUrl(PLATFORMS[0].os, PLATFORMS[0].arch)}
                    download
                  >
                    <Download />
                    Download App
                  </a>
                }
              >
                <Download />
                Download App
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void signOut({ returnTo: "/" })}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
