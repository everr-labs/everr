import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import type { ApplicationIdentity } from "#app/composition/identity.ts";
import { db } from "#app/db/client.ts";
import { assertWorkspaceOwnershipTransferred } from "../installation.server";
import { beforeUserCreate, createSessionOnboardingHook } from "../onboarding";
import { lockWorkspaceMembership, withIdentityRequest } from "../request";

export const identity = {
  async assertAccountDeletionAllowed() {},
  withIdentityRequest,
  beforeUserCreate,
  createSessionOnboardingHook,
  identityAdapter: () => drizzleAdapter(db, { provider: "pg" }),
  organizationHooks: () => ({
    async beforeCreateOrganization() {
      throw new APIError("FORBIDDEN", {
        message:
          "This installation supports one workspace. Use initial setup to create it.",
      });
    },
  }),
  identityLifecycle: {
    beforeMembershipMutation: lockWorkspaceMembership,
    async afterMembershipChange() {},
    async beforeUserDelete(userId: string) {
      await lockWorkspaceMembership();
      try {
        await assertWorkspaceOwnershipTransferred(userId);
      } catch {
        throw new APIError("FORBIDDEN", {
          message: "Transfer workspace ownership before deleting your account.",
        });
      }
    },
    async beforeMembershipChange() {},
    async assertDeletable(_orgId: string) {
      throw new APIError("FORBIDDEN", {
        message: "The installation workspace cannot be deleted.",
      });
    },
  },
} satisfies ApplicationIdentity;
