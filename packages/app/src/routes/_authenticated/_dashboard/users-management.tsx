import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@everr/ui/components/alert-dialog";
import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth.client";
import { auth } from "@/lib/auth.server";
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
  component: UsersManagementPage,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth response types are complex
type AnyRecord = Record<string, any>;

function UsersManagementPage() {
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;

  const [invitations, setInvitations] = useState<AnyRecord[]>([]);
  const [members, setMembers] = useState<AnyRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("member");
  const [inviting, setInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [invRes, memRes] = await Promise.all([
        authClient.organization.listInvitations(),
        authClient.organization.listMembers(),
      ]);
      // Better Auth may return data as an array directly or nested
      const invData = (invRes as AnyRecord)?.data;
      const allInvitations = Array.isArray(invData)
        ? invData
        : Array.isArray(invData?.invitations)
          ? invData.invitations
          : [];
      setInvitations(
        allInvitations.filter((inv: AnyRecord) => inv.status === "pending"),
      );
      const memData = (memRes as AnyRecord)?.data;
      setMembers(
        Array.isArray(memData)
          ? memData
          : Array.isArray(memData?.members)
            ? memData.members
            : [],
      );
    } catch {
      // silently fail — tables will show empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setInviting(true);
    setInviteMessage(null);
    try {
      const res = await authClient.organization.inviteMember({
        email: inviteEmail.trim(),
        role: inviteRole as "member" | "admin" | "owner",
      });
      if ((res as AnyRecord)?.error) {
        setInviteMessage({
          type: "error",
          text:
            (res as AnyRecord).error.message ?? "Failed to send invitation.",
        });
      } else {
        setInviteMessage({
          type: "success",
          text: `Invitation sent to ${inviteEmail.trim()}`,
        });
        setInviteEmail("");
        await loadData();
      }
    } catch {
      setInviteMessage({
        type: "error",
        text: "Failed to send invitation.",
      });
    } finally {
      setInviting(false);
    }
  };

  const handleRevoke = async (invitationId: string) => {
    await authClient.organization.cancelInvitation({ invitationId });
    await loadData();
  };

  const handleRoleChange = async (memberId: string, role: string) => {
    await authClient.organization.updateMemberRole({
      memberId,
      role: role as "member" | "admin" | "owner",
    });
    await loadData();
  };

  const handleRemove = async (memberId: string) => {
    await authClient.organization.removeMember({ memberIdOrEmail: memberId });
    await loadData();
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const ownerCount = members.filter((m) => m.role === "owner").length;

  const invitationColumns: Column<AnyRecord>[] = [
    { header: "Email", cell: (row) => row.email },
    {
      header: "Role",
      cell: (row) => (
        <Badge variant="outline" className="capitalize">
          {row.role}
        </Badge>
      ),
    },
    {
      header: "Expires",
      cell: (row) => formatDate(row.expiresAt),
    },
    {
      header: "",
      cell: (row) => (
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
            Revoke
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke invitation</AlertDialogTitle>
              <AlertDialogDescription>
                This will cancel the invitation to {row.email}. They won't be
                able to join using this link.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleRevoke(row.id)}>
                Revoke
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ),
      cellClassName: "py-2 pr-3 text-right",
      className: "pb-2 pr-3",
    },
  ];

  const memberColumns: Column<AnyRecord>[] = [
    {
      header: "Name",
      cell: (row) => (
        <span>
          {row.user?.name ?? "—"}
          {row.userId === currentUserId && (
            <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
          )}
        </span>
      ),
    },
    {
      header: "Email",
      cell: (row) => row.user?.email ?? "—",
    },
    {
      header: "Role",
      cell: (row) => {
        const isLastOwner = row.role === "owner" && ownerCount <= 1;
        const isSelf = row.userId === currentUserId;

        if (isLastOwner || isSelf) {
          return (
            <Badge variant="outline" className="capitalize">
              {row.role}
            </Badge>
          );
        }

        return (
          <Select
            value={row.role}
            onValueChange={(value) => handleRoleChange(row.id, value as string)}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="owner">Owner</SelectItem>
            </SelectContent>
          </Select>
        );
      },
    },
    {
      header: "Joined",
      cell: (row) => formatDate(row.createdAt),
    },
    {
      header: "",
      cell: (row) => {
        const isSelf = row.userId === currentUserId;
        const isLastOwner = row.role === "owner" && ownerCount <= 1;

        if (isSelf || isLastOwner) return null;

        return (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
              Remove
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove member</AlertDialogTitle>
                <AlertDialogDescription>
                  Remove {row.user?.name ?? row.user?.email} from this
                  organization? They will lose access immediately.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => void handleRemove(row.id)}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        );
      },
      cellClassName: "py-2 pr-3 text-right",
      className: "pb-2 pr-3",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Users Management</h1>
        <p className="text-muted-foreground">
          Manage organization members, invitations, and access.
        </p>
      </div>

      {/* Invite form */}
      <Card>
        <CardHeader>
          <CardTitle>Invite member</CardTitle>
          <CardDescription>
            Send an email invitation to add a new member to your organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInvite} className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(value) => setInviteRole(value as string)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={inviting}>
              {inviting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Send invite
            </Button>
          </form>
          {inviteMessage && (
            <p
              className={`mt-3 text-sm ${
                inviteMessage.type === "success"
                  ? "text-green-600"
                  : "text-destructive"
              }`}
            >
              {inviteMessage.text}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              data={invitations}
              columns={invitationColumns}
              rowKey={(row) => row.id}
            />
          </CardContent>
        </Card>
      )}

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <DataTable
              data={members}
              columns={memberColumns}
              rowKey={(row) => row.id}
              emptyState={
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No members found.
                </p>
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
