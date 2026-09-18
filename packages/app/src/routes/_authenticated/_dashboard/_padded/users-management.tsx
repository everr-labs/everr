import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { PageHeader } from "@/components/page-header";
import { InvitationsTable } from "@/components/users-management/invitations-table";
import { InviteMemberDialog } from "@/components/users-management/invite-member-dialog";
import { MembersTable } from "@/components/users-management/members-table";
import {
  invitationsQueryOptions,
  membersQueryOptions,
} from "@/components/users-management/queries";
import { auth } from "@/lib/auth.server";
import { authClient } from "@/lib/auth-client";
import { readOrgEntitlement } from "@/lib/billing-data.server";
import { isOrganizationAdmin } from "@/lib/organization-role";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

const ensureOrgAdmin = createAuthenticatedServerFn.handler(
  async ({ context: { session } }) => {
    const org = await auth.api.getFullOrganization({
      headers: getRequestHeaders(),
      query: { organizationId: session.session.activeOrganizationId },
    });
    if (!org) return { allowed: false, appState: "hobby" as const };

    const membership = org.members.find((m) => m.userId === session.user.id);
    return {
      allowed: isOrganizationAdmin(membership?.role),
      appState: (await readOrgEntitlement(session.session.activeOrganizationId))
        .appState,
    };
  },
);

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_padded/users-management",
)({
  staticData: { breadcrumb: "Members", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Members" }],
  }),
  beforeLoad: async () => {
    const { allowed, appState } = await ensureOrgAdmin();
    if (!allowed) {
      throw redirect({ to: "/" });
    }
    return { appState };
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
  const { appState } = Route.useRouteContext();
  if (appState === "hobby") return <HobbyMembersCta />;
  return <ProMembersPage />;
}

function HobbyMembersCta() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        title="Members"
        lede="Collaboration is available with the Pro plan."
      />
      <Card>
        <CardHeader>
          <CardTitle>Invite your team with Pro</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Hobby organizations are individual and can only contain their Owner.
            Upgrade to Pro to invite members and manage team access.
          </p>
          <Button nativeButton={false} render={<Link to="/billing" />}>
            View Pro plan
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ProMembersPage() {
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
