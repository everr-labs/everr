import { productUI } from "@composition/ui";

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { InvitationsTable } from "@/components/users-management/invitations-table";
import { InviteMemberDialog } from "@/components/users-management/invite-member-dialog";
import { MembersTable } from "@/components/users-management/members-table";
import {
  invitationsQueryOptions,
  membersQueryOptions,
} from "@/components/users-management/queries";
import { getActiveOrgPolicy } from "@/data/product";
import { authClient } from "@/lib/auth-client";

const { MembersUnavailable } = productUI;

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_padded/_admin/users-management",
)({
  staticData: { breadcrumb: "Members", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Members" }],
  }),
  beforeLoad: async () => {
    const { canInviteMembers } = await getActiveOrgPolicy();
    return { canInviteMembers };
  },
  component: MembersPage,
});

function MembersSkeleton() {
  return (
    <div className="space-y-2 px-3 py-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

function MembersPage() {
  const { canInviteMembers } = Route.useRouteContext();
  if (!canInviteMembers)
    return MembersUnavailable ? <MembersUnavailable /> : null;
  return <OrganizationMembersPage />;
}

function OrganizationMembersPage() {
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;
  const members = useQuery(membersQueryOptions());
  const invitations = useQuery(invitationsQueryOptions());

  const pendingInvitations = invitations.data ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        title="Members"
        lede="Manage organization members, invitations, and access."
      />

      {pendingInvitations.length > 0 && (
        <Card inset="flush-content">
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          <CardContent>
            <InvitationsTable invitations={pendingInvitations} />
          </CardContent>
        </Card>
      )}

      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardAction>
            <InviteMemberDialog />
          </CardAction>
        </CardHeader>
        <CardContent>
          {members.isPending ? (
            <MembersSkeleton />
          ) : (
            <MembersTable
              members={members.data ?? []}
              currentUserId={currentUserId}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
