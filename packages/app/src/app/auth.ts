import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { db } from "#app/db/client.ts";
import type { ApplicationIdentity } from "#app/product/identity.ts";
import { assertWorkspaceOwnershipTransferred } from "./installation.server";
import { beforeUserCreate, createSessionOnboardingHook } from "./onboarding";
import { lockWorkspaceMembership, withIdentityRequest } from "./request";

export const identity = {
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
  authPlugins: () => [],
  membershipPlugin: {
    id: "workspace-membership",
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            [
              "/organization/remove-member",
              "/organization/update-member-role",
              "/organization/leave",
              "/delete-user",
            ].includes(ctx.path ?? ""),
          handler: createAuthMiddleware(async () => {
            await lockWorkspaceMembership();
          }),
        },
      ],
    },
  },
} satisfies ApplicationIdentity;
