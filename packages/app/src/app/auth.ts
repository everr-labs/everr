import type { BetterAuthPlugin } from "better-auth";
import type { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { assertWorkspaceOwnershipTransferred } from "./installation.server";
import { lockWorkspaceMembership } from "./request";

export const identityAdapter = (adapter: ReturnType<typeof drizzleAdapter>) =>
  adapter;
export const organizationHooks = () => ({});
export const beforeCreateOrganization = async () => {
  throw new APIError("FORBIDDEN", {
    message:
      "This installation supports one workspace. Use initial setup to create it.",
  });
};

export const identityLifecycle = {
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
  async beforeMembershipChange(
    _orgId: string,
    _userId: string,
    _role: string | null,
  ) {},
  async assertDeletable(_orgId: string) {
    throw new APIError("FORBIDDEN", {
      message: "The installation workspace cannot be deleted.",
    });
  },
};
export function authPlugins(_createOrganization: unknown): BetterAuthPlugin[] {
  return [];
}

const workspaceMembershipPlugin: BetterAuthPlugin = {
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
};
export const membershipPlugins = [workspaceMembershipPlugin] as const;
