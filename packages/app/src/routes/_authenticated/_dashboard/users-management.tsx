import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { InvitationsTable } from "@/components/users-management/invitations-table";
import { InviteMemberDialog } from "@/components/users-management/invite-member-dialog";
import { MembersTable } from "@/components/users-management/members-table";
import {
  invitationsQueryOptions,
  membersQueryOptions,
} from "@/components/users-management/queries";
import { auth } from "@/lib/auth.server";
import { authClient } from "@/lib/auth-client";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

const ensureOrgAdmin = createAuthenticatedServerFn.handler(
  async ({ context: { session } }) => {
    const org = await auth.api.getFullOrganization({
      headers: getRequestHeaders(),
      query: { organizationId: session.session.activeOrganizationId },
    });
    if (!org) return { allowed: false };

    const membership = org.members.find((m) => m.userId === session.user.id);
    return {
      allowed: membership?.role === "admin" || membership?.role === "owner",
    };
  },
);

export const Route = createFileRoute(
  "/_authenticated/_dashboard/users-management",
)({
  staticData: { breadcrumb: "Users Management", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Users Management" }],
  }),
  beforeLoad: async () => {
    const { allowed } = await ensureOrgAdmin();
    if (!allowed) {
      throw redirect({ to: "/" });
    }
  },
  loader: async ({ context: { queryClient } }) => {
    await Promise.all([
      queryClient.ensureQueryData(membersQueryOptions()),
      queryClient.ensureQueryData(invitationsQueryOptions()),
    ]);
  },
  component: UsersManagementPage,
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

function UsersManagementPage() {
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;
  const members = useQuery(membersQueryOptions());
  const invitations = useQuery(invitationsQueryOptions());

  const pendingInvitations = invitations.data ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Users Management</h1>
        <p className="text-muted-foreground">
          Manage organization members, invitations, and access.
        </p>
      </div>

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
