/* oxlint-disable typescript/consistent-type-assertions -- These erased assertions describe existing trusted data and library contracts; runtime validation would change behavior. */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { INVITATION_EMAIL_HEADER } from "#app/common/invitation.ts";
import { authClient } from "#app/lib/auth-client.ts";

import type { Invitation, Member, OrgRole } from "./schemas";
export type { Invitation, Member, OrgRole } from "./schemas";

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
      return all.filter((inv) => inv.status === "pending");
    },
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { email: string; role: OrgRole; sendEmail: boolean }) => {
      const res = await authClient.organization.inviteMember({
        email: vars.email,
        role: vars.role,
        fetchOptions: {
          headers: { [INVITATION_EMAIL_HEADER]: String(vars.sendEmail) },
        },
      });
      if (res.error) throw new Error(res.error.message ?? "Failed to create invitation");
      if (!res.data) throw new Error("Invitation was not returned");
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
      const res = await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
      });
      if (res.error) throw new Error(res.error.message ?? "Failed to remove member");
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membersQueryKey });
    },
  });
}
