import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { z } from "zod";
import type { IdentityPolicy } from "#app/composition/identity-policy.ts";
import { enforceIdentityPolicy } from "#app/identity/enforce-policy.ts";

type MembershipPolicy = Pick<
  IdentityPolicy,
  "beforeMembershipChange" | "afterMembershipChange"
>;

// Better Auth's leave endpoint bypasses organization member-removal hooks.
export function membershipMutationPlugin(
  policy: MembershipPolicy,
  resolveSession: (
    headers: Headers,
  ) => Promise<{ user: { id: string } } | null>,
  beforeMutation?: () => Promise<void>,
): BetterAuthPlugin {
  return {
    id: "membership-policy",
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
          handler: createAuthMiddleware(async (ctx) => {
            await beforeMutation?.();
            if (ctx.path !== "/organization/leave") return;
            const session = await resolveSession(ctx.headers ?? new Headers());
            if (!session) return;
            const { organizationId } = z
              .object({ organizationId: z.string() })
              .parse(ctx.body);
            const membership = await ctx.context.adapter.findOne({
              model: "member",
              where: [
                { field: "organizationId", value: organizationId },
                { field: "userId", value: session.user.id },
              ],
            });
            if (!membership)
              throw new APIError("FORBIDDEN", {
                message: "You are not a member of this organization.",
              });
            await enforceIdentityPolicy(() =>
              policy.beforeMembershipChange(
                organizationId,
                session.user.id,
                null,
              ),
            );
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === "/organization/leave",
          handler: createAuthMiddleware(async (ctx) => {
            if (isAPIError(ctx.context.returned)) return;
            const session = await resolveSession(ctx.headers ?? new Headers());
            if (!session) return;
            const body = z
              .object({ organizationId: z.string() })
              .safeParse(ctx.body);
            if (body.success)
              await enforceIdentityPolicy(() =>
                policy.afterMembershipChange(body.data.organizationId),
              );
          }),
        },
      ],
    },
  };
}

export function membershipOrganizationHooks(policy: MembershipPolicy) {
  type Input = { member: { organizationId: string; userId: string } };
  const finish = async ({ member }: Input) => {
    await enforceIdentityPolicy(() =>
      policy.afterMembershipChange(member.organizationId),
    );
  };
  return {
    beforeRemoveMember: async ({ member }: Input) => {
      await enforceIdentityPolicy(() =>
        policy.beforeMembershipChange(
          member.organizationId,
          member.userId,
          null,
        ),
      );
    },
    afterRemoveMember: finish,
    beforeUpdateMemberRole: async ({
      member,
      newRole,
    }: Input & { newRole: string }) => {
      await enforceIdentityPolicy(() =>
        policy.beforeMembershipChange(
          member.organizationId,
          member.userId,
          newRole,
        ),
      );
    },
    afterUpdateMemberRole: finish,
    afterAddMember: finish,
    afterAcceptInvitation: finish,
  };
}
