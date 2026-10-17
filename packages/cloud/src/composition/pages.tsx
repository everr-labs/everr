import { OrganizationMembersPage } from "@everr/app/components/users-management/members-page";
import { getActiveOrgPolicy } from "@everr/app/data/product";
import type {
  ApplicationPages,
  OrganizationPageProps,
} from "@everr/app/product/pages";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { MembersUnavailable } from "../components/members-unavailable";

function membersPolicy(organizationId: string) {
  return queryOptions({
    queryKey: ["members-policy", organizationId],
    queryFn: () => getActiveOrgPolicy(),
    staleTime: Infinity,
  });
}

function MembersPage({ organizationId }: OrganizationPageProps) {
  const { data: policy } = useSuspenseQuery(membersPolicy(organizationId));
  return policy.canInviteMembers ? (
    <OrganizationMembersPage />
  ) : (
    <MembersUnavailable />
  );
}

export const pages: ApplicationPages = {
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
