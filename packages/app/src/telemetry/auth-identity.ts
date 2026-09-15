import { createAuthMiddleware } from "better-auth/api";
import { mergeTelemetryIdentity } from "./identity";

type ResolvedSession = {
  session: { expiresAt: Date; activeOrganizationId?: unknown };
  user: { id: string };
};

function attributeSession(resolved: ResolvedSession | null | undefined): void {
  if (!resolved || resolved.session.expiresAt.getTime() <= Date.now()) return;
  mergeTelemetryIdentity({
    userId: resolved.user.id,
    organizationId:
      typeof resolved.session.activeOrganizationId === "string"
        ? resolved.session.activeOrganizationId
        : undefined,
  });
}

export const identityAuthHooks = {
  before: createAuthMiddleware(async (ctx) => {
    const token = await ctx.getSignedCookie(
      ctx.context.authCookies.sessionToken.name,
      ctx.context.secret,
    );
    if (!token) return;
    const adapter = ctx.context.internalAdapter;
    return {
      context: {
        context: {
          internalAdapter: {
            ...adapter,
            // Observe the existing lookup before authenticated handler work.
            // Organization endpoints do not expose sessions to after hooks.
            async findSession(...args: Parameters<typeof adapter.findSession>) {
              const session = await adapter.findSession(...args);
              // Other lookups can concern a session being revoked, not its caller.
              if (args[0] === token) attributeSession(session);
              return session;
            },
          },
        },
      },
    };
  }),
  // Also attribute newly issued sessions (sign-in and device login).
  after: createAuthMiddleware(async (ctx) => {
    attributeSession(ctx.context.newSession ?? ctx.context.session);
  }),
};
