import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { INVITATION_EMAIL_HEADER } from "#app/common/invitation.ts";
import { authClient } from "#app/lib/auth-client.ts";

import {
  InvitationSchema,
  InvitationsResponseSchema,
  InviteMemberInputSchema,
  MembersResponseSchema,
  UpdateMemberRoleInputSchema,
  type InviteMemberInput,
  type UpdateMemberRoleInput,
} from "./schemas";

const CreatedInvitationSchema = InvitationSchema.pick({ id: true });

const membersQueryKey = ["org", "members"] as const;
const invitationsQueryKey = ["org", "invitations"] as const;

export function membersQueryOptions() {
  return queryOptions({
    queryKey: membersQueryKey,
    queryFn: async () => {
      const res = await authClient.organization.listMembers();
      if (res.error) throw new Error(res.error.message ?? "Failed to load members");
      return MembersResponseSchema.parse(res.data);
    },
  });
}

export function invitationsQueryOptions() {
  return queryOptions({
    queryKey: invitationsQueryKey,
    queryFn: async () => {
      const res = await authClient.organization.listInvitations();
      if (res.error) throw new Error(res.error.message ?? "Failed to load invitations");
      const all = InvitationsResponseSchema.parse(res.data);
      return all.filter((inv) => inv.status === "pending");
    },
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: InviteMemberInput) => {
      const input = InviteMemberInputSchema.parse(vars);
      const res = await authClient.organization.inviteMember({
        email: input.email,
        role: input.role,
        fetchOptions: {
          headers: { [INVITATION_EMAIL_HEADER]: String(input.sendEmail) },
        },
      });
      if (res.error) throw new Error(res.error.message ?? "Failed to create invitation");
      if (!res.data) throw new Error("Invitation was not returned");
      const invitation = CreatedInvitationSchema.safeParse(res.data);
      if (!invitation.success) {
        throw new Error("Invitation link could not be loaded. Refresh pending invitations.", {
          cause: invitation.error,
        });
      }
      return invitation.data;
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
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: invitationsQueryKey });
    },
  });
}

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: UpdateMemberRoleInput) => {
      const input = UpdateMemberRoleInputSchema.parse(vars);
      const res = await authClient.organization.updateMemberRole({
        memberId: input.memberId,
        role: input.role,
      });
      if (res.error) throw new Error(res.error.message ?? "Failed to update role");
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
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membersQueryKey });
    },
  });
}
