import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { z } from "zod";
import { billing } from "./server";

// Better Auth's leave endpoint bypasses organization member-removal hooks.
type MembershipBilling = Pick<
  typeof billing,
  "beforeMembershipChange" | "afterMembershipChange"
>;
export function billingMembershipPlugin(
  module: MembershipBilling = billing,
): BetterAuthPlugin {
  return {
    id: "billing-membership",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/organization/leave",
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
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
            await module.beforeMembershipChange(
              organizationId,
              session.user.id,
              null,
            );
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === "/organization/leave",
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            if (!session) return;
            const body = z
              .object({ organizationId: z.string() })
              .safeParse(ctx.body);
            if (body.success)
              await module.afterMembershipChange(body.data.organizationId);
          }),
        },
      ],
    },
  };
}

export function billingOrganizationHooks(module: MembershipBilling = billing) {
  type Input = { member: { organizationId: string; userId: string } };
  const finish = async ({ member }: Input) => {
    await module.afterMembershipChange(member.organizationId);
  };
  return {
    beforeRemoveMember: async ({ member }: Input) => {
      await module.beforeMembershipChange(
        member.organizationId,
        member.userId,
        null,
      );
    },
    afterRemoveMember: finish,
    beforeUpdateMemberRole: async ({
      member,
      newRole,
    }: Input & { newRole: string }) => {
      await module.beforeMembershipChange(
        member.organizationId,
        member.userId,
        newRole,
      );
    },
    afterUpdateMemberRole: finish,
    afterAddMember: finish,
    afterAcceptInvitation: finish,
  };
}
