import { AccountSettings } from "@everr/app/account-settings";
import type { ApplicationPages, OrganizationPageProps } from "@everr/app/composition";
import { getActiveOrgPolicy } from "@everr/app/data/product";
import { OrganizationMembersPage } from "@everr/app/members";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { AccountDeletion } from "../../components/account-deletion";
import { MembersUnavailable } from "../../components/members-unavailable";

function membersPolicy(organizationId: string) {
  return queryOptions({
    queryKey: ["members-policy", organizationId],
    queryFn: () => getActiveOrgPolicy(),
    staleTime: Infinity,
  });
}

function MembersPage({ organizationId }: OrganizationPageProps) {
  const { data: policy } = useSuspenseQuery(membersPolicy(organizationId));
  return policy.canInviteMembers ? <OrganizationMembersPage /> : <MembersUnavailable />;
}

export const pages: ApplicationPages = {
  account: (props) => (
    <AccountSettings {...props}>
      <AccountDeletion />
    </AccountSettings>
  ),
  members: {
    async load({ queryClient, organizationId }) {
      await queryClient.fetchQuery({
        ...membersPolicy(organizationId),
        staleTime: 0,
      });
    },
    component: MembersPage,
  },
};
