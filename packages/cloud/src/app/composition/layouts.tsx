import type { ApplicationLayouts } from "@everr/app/composition";
import { UserMenu } from "@everr/app/user-menu";
import { WelcomeLayout } from "@everr/app/welcome";
import { OrganizationMenuItems, WelcomeActions, WorkspaceMenu } from "../navigation";

export const layouts: ApplicationLayouts = {
  UserMenu: () => (
    <UserMenu
      beforeOrganization={<WorkspaceMenu />}
      organizationItems={<OrganizationMenuItems />}
    />
  ),
  Welcome: ({ activeOrganizationId, ...props }) => (
    <WelcomeLayout
      {...props}
      actions={<WelcomeActions activeOrganizationId={activeOrganizationId} />}
    />
  ),
};
