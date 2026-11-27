import { useRetained } from "@everr/ui/hooks/use-retained";
/* oxlint-disable typescript/consistent-type-assertions -- These erased assertions describe existing trusted data and library contracts; runtime validation would change behavior. */
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
import { type Column, DataTable } from "@everr/ui/components/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { useState } from "react";
import { progressToast } from "#app/lib/progress-toast.ts";
import { formatDay } from "@everr/ui/lib/timestamp";
import { type Member, type OrgRole, useRemoveMember, useUpdateMemberRole } from "./queries";

interface MembersTableProps {
  members: Member[];
  currentUserId: string | undefined;
}

interface RoleChangePending {
  memberId: string;
  memberName: string;
  currentRole: Member["role"];
  nextRole: OrgRole;
}

export function MembersTable({ members, currentUserId }: MembersTableProps) {
  const updateRole = useUpdateMemberRole();
  const remove = useRemoveMember();
  const [rolePending, setRolePending] = useState<RoleChangePending | null>(null);
  const shownRole = useRetained(rolePending);

  const ownerCount = members.filter((m) => m.role === "owner").length;

  const confirmRoleChange = () => {
    if (!rolePending) return;
    const { memberId, memberName, nextRole } = rolePending;
    const clearIfStillMine = () => setRolePending((p) => (p?.memberId === memberId ? null : p));
    const progress = progressToast(`Making ${memberName} ${nextRole}…`);
    updateRole.mutate(
      { memberId, role: nextRole },
      {
        onSuccess: () => {
          progress.success(`${memberName} is now ${nextRole}`);
          clearIfStillMine();
        },
        onError: (err) => {
          progress.error(err.message);
          clearIfStillMine();
        },
      },
    );
  };

  const handleRemove = (memberId: string, memberName: string) => {
    const progress = progressToast(`Removing ${memberName}…`);
    remove.mutate(memberId, {
      onSuccess: () => progress.success(`${memberName} removed`),
      onError: (err) => progress.error(err.message),
    });
  };

  const columns: Column<Member>[] = [
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
            onValueChange={(value) => {
              const next = value as OrgRole;
              if (next === row.role) return;
              setRolePending({
                memberId: row.id,
                memberName: row.user?.name ?? row.user?.email ?? "Member",
                currentRole: row.role,
                nextRole: next,
              });
            }}
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
      cell: (row) => formatDay(row.createdAt, "always"),
    },
    {
      header: <span className="sr-only">Actions</span>,
      cell: (row) => {
        const isSelf = row.userId === currentUserId;
        const isLastOwner = row.role === "owner" && ownerCount <= 1;
        if (isSelf || isLastOwner) return null;
        const memberName = row.user?.name ?? row.user?.email ?? "this member";

        return (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
              Remove
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove member</AlertDialogTitle>
                <AlertDialogDescription>
                  Remove {memberName} from this organization? They will lose access immediately.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => handleRemove(row.id, memberName)}
                  disabled={remove.isPending}
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
    <>
      <DataTable
        data={members}
        columns={columns}
        rowKey={(row) => row.id}
        animateRows
        emptyState={
          <p className="py-8 text-center text-sm text-muted-foreground">No members found.</p>
        }
      />
      <AlertDialog
        open={rolePending !== null}
        onOpenChange={(open) => {
          if (!open) setRolePending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change role</AlertDialogTitle>
            <AlertDialogDescription>
              {shownRole && (
                <>
                  Change {shownRole.memberName}&apos;s role from{" "}
                  <span className="capitalize">{shownRole.currentRole}</span> to{" "}
                  <span className="capitalize">{shownRole.nextRole}</span>?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRoleChange} disabled={updateRole.isPending}>
              Change role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
