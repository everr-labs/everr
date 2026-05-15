import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";

type ListMembersResult = Awaited<
  ReturnType<typeof authClient.organization.listMembers>
>;
type ListInvitationsResult = Awaited<
  ReturnType<typeof authClient.organization.listInvitations>
>;

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
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as Record<string, unknown>)[key])
  ) {
    return (value as Record<string, T[]>)[key];
  }
  return [];
}

const membersQueryKey = ["org", "members"] as const;
const invitationsQueryKey = ["org", "invitations"] as const;

export function membersQueryOptions() {
  return queryOptions({
    queryKey: membersQueryKey,
    queryFn: async () => {
      const res = await authClient.organization.listMembers();
      if (res.error)
        throw new Error(res.error.message ?? "Failed to load members");
      return unwrapArray<Member>(res.data, "members");
    },
  });
}

export function invitationsQueryOptions() {
  return queryOptions({
    queryKey: invitationsQueryKey,
    queryFn: async () => {
      const res = await authClient.organization.listInvitations();
      if (res.error)
        throw new Error(res.error.message ?? "Failed to load invitations");
      const all = unwrapArray<Invitation>(res.data, "invitations");
      return all.filter(
        (inv) => (inv as { status?: string }).status === "pending",
      );
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
      if (res.error)
        throw new Error(res.error.message ?? "Failed to send invitation");
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
      const res = await authClient.organization.cancelInvitation({
        invitationId,
      });
      if (res.error)
        throw new Error(res.error.message ?? "Failed to revoke invitation");
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
      if (res.error)
        throw new Error(res.error.message ?? "Failed to update role");
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
      const res = await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
      });
      if (res.error)
        throw new Error(res.error.message ?? "Failed to remove member");
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membersQueryKey });
    },
  });
}
