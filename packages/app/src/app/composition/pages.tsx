import { AccountSettings } from "#app/components/account-settings/account-settings.tsx";
import { DeleteAccount } from "#app/components/account-settings/delete-account.tsx";
import {
  OrganizationMembersPage,
  prefetchMembersPage,
} from "#app/components/users-management/members-page.tsx";
import type { ApplicationPages } from "#app/composition/pages.ts";

export const pages: ApplicationPages = {
  account: (props) => (
    <AccountSettings {...props}>
      <DeleteAccount />
    </AccountSettings>
  ),
  members: {
    load: ({ queryClient }) => prefetchMembersPage(queryClient),
    component: OrganizationMembersPage,
  },
};
