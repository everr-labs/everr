# Users Management Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `packages/app/src/routes/_authenticated/_dashboard/users-management.tsx` into a set of well-typed, TanStack-Query-backed components with a dialog-based invite flow, confirmed role changes, and full-bleed tables.

**Architecture:** Split the route into focused components under `packages/app/src/components/users-management/`. A `queries.ts` module owns data fetching and mutations with types derived from `authClient.organization.*` return shapes. Each table component owns its confirmation dialogs. All success/error feedback flows through `sonner` toasts. The route file keeps only the admin guard, loader prefetch, and page shell.

**Tech Stack:** React 19, TanStack Router, TanStack Query, Better-Auth, shadcn/ui (Base UI primitives), sonner, Tailwind.

**Testing convention:** This route has no existing unit tests and the project convention is visual verification by the user at Vite's `:5173`. This plan does not introduce test files; typecheck and biome are the mechanical gates, and the user verifies UI.

---

## File Structure

- Create: `packages/app/src/components/users-management/queries.ts` — typed queryOptions + mutation hooks.
- Create: `packages/app/src/components/users-management/invitations-table.tsx` — pending invitations table with revoke confirm.
- Create: `packages/app/src/components/users-management/invite-member-dialog.tsx` — trigger button + dialog form.
- Create: `packages/app/src/components/users-management/members-table.tsx` — members table with role-change confirm and remove confirm.
- Modify: `packages/app/src/routes/_authenticated/_dashboard/users-management.tsx` — route shrinks to guard + loader prefetch + page shell.

Package-internal imports use `@/components/users-management/<file>`.

---

### Task 1: Queries and mutations module

**Files:**
- Create: `packages/app/src/components/users-management/queries.ts`

- [ ] **Step 1: Create `queries.ts` with typed queryOptions and mutation hooks**

```ts
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";

type ListMembersResult = Awaited<ReturnType<typeof authClient.organization.listMembers>>;
type ListInvitationsResult = Awaited<ReturnType<typeof authClient.organization.listInvitations>>;

type MembersData = NonNullable<ListMembersResult["data"]>;
type InvitationsData = NonNullable<ListInvitationsResult["data"]>;

// Better-Auth returns either an array or { members: [...] } / { invitations: [...] } depending on version.
// Normalise at the edge so the rest of the app sees a plain array.
type RawMembers = MembersData extends readonly unknown[]
  ? MembersData
  : MembersData extends { members: infer M extends readonly unknown[] }
    ? M
    : never;
type RawInvitations = InvitationsData extends readonly unknown[]
  ? InvitationsData
  : InvitationsData extends { invitations: infer I extends readonly unknown[] }
    ? I
    : never;

export type Member = RawMembers[number];
export type Invitation = RawInvitations[number];
export type OrgRole = "member" | "admin" | "owner";

function unwrapArray<T>(value: unknown, key: "members" | "invitations"): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>)[key])) {
    return (value as Record<string, T[]>)[key];
  }
  return [];
}

export const membersQueryKey = ["org", "members"] as const;
export const invitationsQueryKey = ["org", "invitations"] as const;

export function membersQueryOptions() {
  return queryOptions({
    queryKey: membersQueryKey,
    queryFn: async () => {
      const res = await authClient.organization.listMembers();
      if (res.error) throw new Error(res.error.message ?? "Failed to load members");
      return unwrapArray<Member>(res.data, "members");
    },
  });
}

export function invitationsQueryOptions() {
  return queryOptions({
    queryKey: invitationsQueryKey,
    queryFn: async () => {
      const res = await authClient.organization.listInvitations();
      if (res.error) throw new Error(res.error.message ?? "Failed to load invitations");
      const all = unwrapArray<Invitation>(res.data, "invitations");
      return all.filter((inv) => (inv as { status?: string }).status === "pending");
    },
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { email: string; role: OrgRole }) => {
      const res = await authClient.organization.inviteMember({
        email: vars.email,
        role: vars.role,
      });
      if (res.error) throw new Error(res.error.message ?? "Failed to send invitation");
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: invitationsQueryKey });
    },
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string) => {
      const res = await authClient.organization.cancelInvitation({ invitationId });
      if (res.error) throw new Error(res.error.message ?? "Failed to revoke invitation");
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: invitationsQueryKey });
    },
  });
}

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { memberId: string; role: OrgRole }) => {
      const res = await authClient.organization.updateMemberRole({
        memberId: vars.memberId,
        role: vars.role,
      });
      if (res.error) throw new Error(res.error.message ?? "Failed to update role");
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membersQueryKey });
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      const res = await authClient.organization.removeMember({ memberIdOrEmail: memberId });
      if (res.error) throw new Error(res.error.message ?? "Failed to remove member");
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membersQueryKey });
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @everr/app typecheck`
Expected: PASS (no new errors).

If better-auth's typed return shape differs from the inferred ones above (for example, `data` is typed as `{ members: Member[] }` vs `Member[]`), adjust the `RawMembers` / `RawInvitations` conditional types so the chosen branch compiles. The runtime `unwrapArray` keeps both shapes safe regardless.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/users-management/queries.ts
git commit -m "feat(app): extract users-management queries + mutations"
```

---

### Task 2: Invitations table

**Files:**
- Create: `packages/app/src/components/users-management/invitations-table.tsx`

- [ ] **Step 1: Create the component**

```tsx
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
import { toast } from "sonner";
import { type Invitation, useRevokeInvitation } from "./queries";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatDate(dateStr: string | Date) {
  try {
    return dateFormatter.format(new Date(dateStr));
  } catch {
    return String(dateStr);
  }
}

interface InvitationsTableProps {
  invitations: Invitation[];
}

export function InvitationsTable({ invitations }: InvitationsTableProps) {
  const revoke = useRevokeInvitation();

  const handleRevoke = (invitationId: string, email: string) => {
    revoke.mutate(invitationId, {
      onSuccess: () => toast.success(`Invitation to ${email} revoked`),
      onError: (err) => toast.error(err.message),
    });
  };

  const columns: Column<Invitation>[] = [
    { header: "Email", cell: (row) => (row as { email: string }).email },
    {
      header: "Role",
      cell: (row) => (
        <Badge variant="outline" className="capitalize">
          {(row as { role: string }).role}
        </Badge>
      ),
    },
    {
      header: "Expires",
      cell: (row) => formatDate((row as { expiresAt: string | Date }).expiresAt),
    },
    {
      header: "",
      cell: (row) => {
        const r = row as { id: string; email: string };
        return (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
              Revoke
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke invitation</AlertDialogTitle>
                <AlertDialogDescription>
                  This will cancel the invitation to {r.email}. They won't be
                  able to join using this link.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => handleRevoke(r.id, r.email)}>
                  Revoke
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

  return <DataTable data={invitations} columns={columns} rowKey={(row) => (row as { id: string }).id} />;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @everr/app typecheck`
Expected: PASS.

If better-auth exposes strong types for invitation fields (e.g. `Invitation["email"]`), remove the narrow `row as { ... }` casts in favour of direct property access. The casts are a seam for the common case where `Invitation` is `unknown`-ish; keep them only if the direct access doesn't compile.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/users-management/invitations-table.tsx
git commit -m "feat(app): add invitations table component"
```

---

### Task 3: Invite member dialog

**Files:**
- Create: `packages/app/src/components/users-management/invite-member-dialog.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { type OrgRole, useInviteMember } from "./queries";

export function InviteMemberDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const invite = useInviteMember();

  const reset = () => {
    setEmail("");
    setRole("member");
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    invite.mutate(
      { email: trimmed, role },
      {
        onSuccess: () => {
          toast.success(`Invitation sent to ${trimmed}`);
          setOpen(false);
          reset();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>Invite member</DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>
              Send an email invitation to add a new member to your organization.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
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
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={invite.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @everr/app typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/users-management/invite-member-dialog.tsx
git commit -m "feat(app): add invite member dialog"
```

---

### Task 4: Members table with role-change + remove confirmation

**Files:**
- Create: `packages/app/src/components/users-management/members-table.tsx`

- [ ] **Step 1: Create the component**

```tsx
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
import { toast } from "sonner";
import {
  type Member,
  type OrgRole,
  useRemoveMember,
  useUpdateMemberRole,
} from "./queries";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatDate(dateStr: string | Date) {
  try {
    return dateFormatter.format(new Date(dateStr));
  } catch {
    return String(dateStr);
  }
}

interface MembersTableProps {
  members: Member[];
  currentUserId: string | undefined;
}

interface RoleChangePending {
  memberId: string;
  memberName: string;
  currentRole: OrgRole;
  nextRole: OrgRole;
}

type MemberRow = {
  id: string;
  userId: string;
  role: OrgRole;
  createdAt: string | Date;
  user?: { name?: string | null; email?: string | null } | null;
};

export function MembersTable({ members, currentUserId }: MembersTableProps) {
  const updateRole = useUpdateMemberRole();
  const remove = useRemoveMember();
  const [rolePending, setRolePending] = useState<RoleChangePending | null>(null);

  const ownerCount = members.filter((m) => (m as MemberRow).role === "owner").length;

  const confirmRoleChange = () => {
    if (!rolePending) return;
    const { memberId, memberName, nextRole } = rolePending;
    updateRole.mutate(
      { memberId, role: nextRole },
      {
        onSuccess: () => {
          toast.success(`${memberName} is now ${nextRole}`);
          setRolePending(null);
        },
        onError: (err) => {
          toast.error(err.message);
          setRolePending(null);
        },
      },
    );
  };

  const handleRemove = (memberId: string, memberName: string) => {
    remove.mutate(memberId, {
      onSuccess: () => toast.success(`${memberName} removed`),
      onError: (err) => toast.error(err.message),
    });
  };

  const columns: Column<Member>[] = [
    {
      header: "Name",
      cell: (row) => {
        const m = row as MemberRow;
        return (
          <span>
            {m.user?.name ?? "—"}
            {m.userId === currentUserId && (
              <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
            )}
          </span>
        );
      },
    },
    {
      header: "Email",
      cell: (row) => (row as MemberRow).user?.email ?? "—",
    },
    {
      header: "Role",
      cell: (row) => {
        const m = row as MemberRow;
        const isLastOwner = m.role === "owner" && ownerCount <= 1;
        const isSelf = m.userId === currentUserId;

        if (isLastOwner || isSelf) {
          return (
            <Badge variant="outline" className="capitalize">
              {m.role}
            </Badge>
          );
        }

        return (
          <Select
            value={m.role}
            onValueChange={(value) => {
              const next = value as OrgRole;
              if (next === m.role) return;
              setRolePending({
                memberId: m.id,
                memberName: m.user?.name ?? m.user?.email ?? "Member",
                currentRole: m.role,
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
      cell: (row) => formatDate((row as MemberRow).createdAt),
    },
    {
      header: "",
      cell: (row) => {
        const m = row as MemberRow;
        const isSelf = m.userId === currentUserId;
        const isLastOwner = m.role === "owner" && ownerCount <= 1;
        if (isSelf || isLastOwner) return null;
        const memberName = m.user?.name ?? m.user?.email ?? "this member";

        return (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
              Remove
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove member</AlertDialogTitle>
                <AlertDialogDescription>
                  Remove {memberName} from this organization? They will lose
                  access immediately.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => handleRemove(m.id, memberName)}
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
        rowKey={(row) => (row as MemberRow).id}
        emptyState={
          <p className="py-8 text-center text-sm text-muted-foreground">
            No members found.
          </p>
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
              {rolePending && (
                <>
                  Change {rolePending.memberName}'s role from{" "}
                  <span className="capitalize">{rolePending.currentRole}</span>{" "}
                  to <span className="capitalize">{rolePending.nextRole}</span>?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRoleChange}
              disabled={updateRole.isPending}
            >
              Change role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @everr/app typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/users-management/members-table.tsx
git commit -m "feat(app): add members table with role-change confirmation"
```

---

### Task 5: Refactor route to use new components

**Files:**
- Modify: `packages/app/src/routes/_authenticated/_dashboard/users-management.tsx` — full rewrite.

- [ ] **Step 1: Replace the route file contents**

```tsx
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
import { InviteMemberDialog } from "@/components/users-management/invite-member-dialog";
import { InvitationsTable } from "@/components/users-management/invitations-table";
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @everr/app typecheck`
Expected: PASS.

- [ ] **Step 3: Lint the refactored files**

Run: `pnpm --filter @everr/app lint`
Expected: PASS (or auto-fix any trivial biome complaints).

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/routes/_authenticated/_dashboard/users-management.tsx
git commit -m "refactor(app): slim users-management route to guard + shell"
```

---

### Task 6: Final verification

**Files:** (no changes — verification only)

- [ ] **Step 1: Typecheck the whole app package**

Run: `pnpm --filter @everr/app typecheck`
Expected: PASS.

- [ ] **Step 2: Lint**

Run: `pnpm --filter @everr/app lint`
Expected: PASS.

- [ ] **Step 3: Ask the user to visually verify**

Do NOT start the dev server. The user runs Vite at :5173 and verifies visually. Post a checklist for them:

- Members card: full-bleed rows, "Invite member" button top-right of card header.
- Click "Invite member" → dialog opens → submit invites → toast success → dialog closes → invitations card appears.
- Submit invite with duplicate email → toast error → dialog stays open.
- Change a non-self, non-last-owner member's role via the Select → confirmation dialog → confirm → toast success; cancel keeps old role.
- Remove a non-self member → confirmation dialog → confirm → toast success; row disappears.
- Revoke a pending invitation → confirmation dialog → confirm → toast success; card disappears when list empty.
- As a non-admin user, visiting the page redirects to `/`.

- [ ] **Step 4: After user confirms, no commit needed (verification only)**

---

## Notes for the implementer

- Do not run the dev server (`vite`, `pnpm dev`, `pnpm start`) — per this repo's conventions, the user runs Vite themselves at :5173 and verifies UI visually. Rely on `pnpm --filter @everr/app typecheck` and `pnpm --filter @everr/app lint` for automated feedback.
- Do not touch `ensureOrgAdmin`; it is load-bearing and belongs to the route.
- `authClient.organization.*` methods return `{ data, error }`. The `queries.ts` queryFn unwraps and throws on error so `useQuery`/`useMutation` see normal resolved/rejected promises.
- `Card` supports `inset="flush-content"`; `CardContent` auto-drops horizontal padding when the parent has that attribute. Don't override `px-0` by hand.
- `AlertDialogTrigger` uses the Base UI `render` prop pattern (`render={<Button ... />}`) — this is already used elsewhere in the codebase.
- When invoking mutations from components, pass `onSuccess`/`onError` at the call site (not in the hook) when the side effect needs access to local state (e.g. closing a dialog or clearing the `rolePending` sentinel).
