import type { IdentityPolicy } from "#app/composition/identity-policy.ts";
import type { Database } from "#app/db/database.ts";
import { IdentityPolicyError } from "#app/identity/policy-error.ts";
import { assertInvitedUser } from "./installation.server";

export function createInstallationIdentityPolicy(
  database: Database,
): IdentityPolicy {
  return {
    beforeUserCreate: (user, invitationId) =>
      assertInvitedUser(user, invitationId, database),
    async assertAccountDeletionAllowed() {},
    async afterMembershipChange() {},
    async beforeUserDelete() {},
    async beforeMembershipChange() {},
    async assertDeletable() {
      throw new IdentityPolicyError(
        "The installation workspace cannot be deleted.",
      );
    },
  };
}
