import type { IdentityPolicy } from "#app/composition/identity-policy.ts";
import { IdentityPolicyError } from "#app/identity/policy-error.ts";
import {
  assertInvitedUser,
  assertWorkspaceOwnershipTransferred,
} from "./installation.server";

export const identityPolicy: IdentityPolicy = {
  async beforeUserCreate(user, invitationId) {
    try {
      await assertInvitedUser(user, invitationId);
    } catch {
      throw new IdentityPolicyError(
        "Contact your administrator for an invitation.",
      );
    }
  },
  async assertAccountDeletionAllowed() {},

  async afterMembershipChange() {},
  async beforeUserDelete(userId: string) {
    try {
      await assertWorkspaceOwnershipTransferred(userId);
    } catch {
      throw new IdentityPolicyError(
        "Transfer workspace ownership before deleting your account.",
      );
    }
  },
  async beforeMembershipChange() {},
  async assertDeletable(_orgId: string) {
    throw new IdentityPolicyError(
      "The installation workspace cannot be deleted.",
    );
  },
};
