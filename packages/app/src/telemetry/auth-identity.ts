import { getCurrentAuthContext } from "@better-auth/core/context";
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

// Read after before-hooks have normalized bearer credentials into a signed cookie.
const callerSessionToken = createAuthMiddleware((ctx) =>
  ctx.getSignedCookie(
    ctx.context.authCookies.sessionToken.name,
    ctx.context.secret,
  ),
);

export const identityAuthHooks = {
  before: createAuthMiddleware(async (ctx) => {
    const adapter = ctx.context.internalAdapter;
    const findSession = async (sessionToken: string) => {
      const current = await getCurrentAuthContext();
      const token = await callerSessionToken({
        ...current,
        returnHeaders: false,
      });
      const session = await adapter.findSession(sessionToken);
      // A lookup for a session being revoked must not change caller identity.
      if (sessionToken === token) attributeSession(session);
      return session;
    };
    // Better Auth merges this override into the request's context. Observe the
    // existing lookup because organization endpoints bypass global after hooks.
    return { context: { context: { internalAdapter: { findSession } } } };
  }),
  // Also attribute newly issued sessions (sign-in and device login).
  after: createAuthMiddleware(async (ctx) => {
    attributeSession(ctx.context.newSession ?? ctx.context.session);
  }),
};
