import type { BetterAuthPlugin } from "better-auth";
import {
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
} from "better-auth/api";
import { z } from "zod";
import { isOrganizationAdmin } from "#app/lib/organization-role.ts";

const organizationResponse = z
  .object({
    id: z.string(),
    invitations: z.array(z.unknown()),
  })
  .passthrough();

// Invitation IDs authorize signup without SMTP. Better Auth exposes them to
// every member by default, including in its full-organization response.
export function invitationVisibilityPlugin(): BetterAuthPlugin {
  return {
    id: "invitation-visibility",
    hooks: {
      after: [
        {
          matcher: (ctx) =>
            [
              "/organization/list-invitations",
              "/organization/get-full-organization",
            ].includes(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned;
            if (returned == null || isAPIError(returned)) return;
            const session = await getSessionFromCtx(ctx);
            if (!session) return;
            const organization =
              ctx.path === "/organization/get-full-organization"
                ? organizationResponse.parse(returned)
                : undefined;
            const organizationId =
              organization?.id ??
              ctx.query?.organizationId ??
              session.session.activeOrganizationId;
            const membership = await ctx.context.adapter.findOne<{
              role: string;
            }>({
              model: "member",
              where: [
                { field: "organizationId", value: organizationId },
                { field: "userId", value: session.user.id },
              ],
            });
            if (isOrganizationAdmin(membership?.role)) return;
            return ctx.json(
              organization ? { ...organization, invitations: [] } : [],
            );
          }),
        },
      ],
    },
  };
}
