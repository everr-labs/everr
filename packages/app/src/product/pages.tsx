import type { QueryClient } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { AccountSettings } from "#app/components/account-settings/account-settings.tsx";
import { DeleteAccount } from "#app/components/account-settings/delete-account.tsx";
import { OrganizationMembersPage } from "#app/components/users-management/members-page.tsx";

export interface OrganizationPageProps {
  organizationId: string;
}

/** Page loading runs inside the application's existing access guards. */
export interface OrganizationPage {
  component: ComponentType<OrganizationPageProps>;
  load?: (
    context: OrganizationPageProps & { queryClient: QueryClient },
  ) => Promise<void>;
}

export interface AccountPageProps {
  googleSignInEnabled: boolean;
}

export interface ApplicationPages {
  account: ComponentType<AccountPageProps>;
  members: OrganizationPage;
}

export const pages: ApplicationPages = {
  account: (props) => (
    <AccountSettings {...props}>
      <DeleteAccount />
    </AccountSettings>
  ),
  members: { component: OrganizationMembersPage },
};
