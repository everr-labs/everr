import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "#app/components/page-header.tsx";
import { InvitationsTable } from "#app/components/users-management/invitations-table.tsx";
import { InviteMemberDialog } from "#app/components/users-management/invite-member-dialog.tsx";
import { MembersTable } from "#app/components/users-management/members-table.tsx";
import {
  invitationsQueryOptions,
  membersQueryOptions,
} from "#app/components/users-management/queries.ts";
import { authClient } from "#app/lib/auth-client.ts";

function MembersSkeleton() {
  return (
    <div className="space-y-2 px-3 py-2">
      {Array.from({ length: 4 }).map((_, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- static placeholder skeleton list with no data-backed key
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function OrganizationMembersPage() {
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;
  const members = useQuery(membersQueryOptions());
  const invitations = useQuery(invitationsQueryOptions());

  const pendingInvitations = invitations.data ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader title="Members" lede="Manage organization members, invitations, and access." />

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
            <MembersTable members={members.data ?? []} currentUserId={currentUserId} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
