import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@everr/ui/components/sidebar";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import {
  Check,
  ChevronsUpDown,
  CookieIcon,
  CreditCard,
  Download,
  GitPullRequest,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  ReceiptText,
  Settings,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { getOrgPortalUrl } from "@/data/billing";
import { PLATFORMS } from "@/lib/app-download";
import { authClient } from "@/lib/auth-client";
import { isOrganizationAdmin } from "@/lib/organization-role";
import { useOpenConsentSettings } from "@/telemetry/consent-gate";

export function NavUser() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const openConsentSettings = useOpenConsentSettings();
  const { data: session } = authClient.useSession();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const { data: orgs } = authClient.useListOrganizations();
  const downloadUrl = PLATFORMS[0].downloadUrl;
  const userRole = activeOrg?.members?.find(
    (m) => m.userId === session?.user?.id,
  )?.role;
  const isAdmin = isOrganizationAdmin(userRole);
  const portalMutation = useMutation({
    mutationFn: () => getOrgPortalUrl(),
    onSuccess: (result) => {
      if (result.status === "customer_missing") {
        void router.navigate({ to: "/billing" });
        toast.error("Set up a billing email before opening billing details.");
        return;
      }

      window.location.href = result.url;
    },
    onError: () => {
      toast.error("We couldn't open billing details. Please try again.");
    },
  });

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
            <div className="grid flex-1 text-left text-sm leading-tight transition-opacity duration-200 ease-sidebar motion-reduce:transition-none group-data-[collapsible=icon]:opacity-0">
              <span className="overflow-hidden whitespace-nowrap font-medium">
                {fullName}
              </span>
              <span className="overflow-hidden whitespace-nowrap text-xs">
                {activeOrg?.name ?? " "}
              </span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--anchor-width) min-w-56 rounded-lg"
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
                <span className="truncate text-xs">
                  {activeOrg?.name ?? " "}
                </span>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Organization</DropdownMenuLabel>
              {orgs?.map((org) => (
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
              <DropdownMenuItem
                nativeButton={false}
                render={<Link to="/organizations/new" />}
              >
                <Plus />
                Create organization
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {activeOrg ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Organization settings</DropdownMenuLabel>
                  {isAdmin ? (
                    <>
                      <DropdownMenuItem
                        render={<Link to="/users-management" />}
                        nativeButton={false}
                      >
                        <Users />
                        Members
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        render={<Link to="/api-keys" />}
                        nativeButton={false}
                      >
                        <KeyRound />
                        API keys
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  <DropdownMenuItem
                    render={<Link to="/github" />}
                    nativeButton={false}
                  >
                    <GitPullRequest />
                    GitHub
                  </DropdownMenuItem>
                  {isAdmin ? (
                    <>
                      <DropdownMenuItem
                        closeOnClick={false}
                        disabled={portalMutation.isPending}
                        onClick={() => portalMutation.mutate()}
                      >
                        {portalMutation.isPending ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <ReceiptText />
                        )}
                        {portalMutation.isPending
                          ? "Opening billing details..."
                          : "Billing details"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        render={<Link to="/billing" />}
                        nativeButton={false}
                      >
                        <CreditCard />
                        Plan &amp; Billing
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuGroup>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Account &amp; privacy</DropdownMenuLabel>
              <DropdownMenuItem
                render={<Link to="/account" />}
                nativeButton={false}
              >
                <Settings />
                Account settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={openConsentSettings}>
                <CookieIcon />
                Privacy preferences
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                nativeButton={false}
                render={
                  <a href={downloadUrl} download>
                    <Download />
                    Download App
                  </a>
                }
              />
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
