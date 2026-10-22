import { authClient } from "@everr/app/identity/client";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@everr/ui/components/dropdown-menu";
import { Link, useLocation } from "@tanstack/react-router";
import { Check, CreditCard, Plus } from "lucide-react";
import { toast } from "sonner";
import { useOrganizationActivation } from "../components/use-organization-activation";

export function OrganizationMenuItems() {
  return (
    <DropdownMenuItem render={<Link to="/billing" />} nativeButton={false}>
      <CreditCard />
      Plan &amp; Billing
    </DropdownMenuItem>
  );
}

import { OrganizationSwitcher } from "../components/organization-switcher";

export function WelcomeActions(props: { activeOrganizationId?: string | null }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  return pathname === "/organization-setup" ? <OrganizationSwitcher {...props} /> : null;
}
export function WorkspaceMenu() {
  const activateOrganization = useOrganizationActivation();
  const { data: orgs } = authClient.useListOrganizations();
  const { data: activeOrg } = authClient.useActiveOrganization();
  async function handleSwitchOrg(orgId: string) {
    try {
      await activateOrganization(orgId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not switch organization.");
    }
  }
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Organization</DropdownMenuLabel>
      {orgs?.map((org) => (
        <DropdownMenuItem key={org.id} onClick={() => void handleSwitchOrg(org.id)}>
          {org.id === activeOrg?.id ? <Check /> : <span className="size-4" />}
          <span className="truncate">{org.name}</span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem
        render={<Link to="/create-organization" search={{ returnTo: "/" }} />}
        nativeButton={false}
      >
        <Plus />
        Create organization
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}
