import type { Session, User } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { mergeTelemetryIdentity } from "./identity";

export type ResolvedSession = {
  session: Session & { activeOrganizationId?: unknown };
  user: User;
};

function attributeSession(resolved: ResolvedSession | null | undefined): void {
  if (
    !resolved ||
    !(new Date(resolved.session.expiresAt).getTime() > Date.now())
  )
    return;
  mergeTelemetryIdentity({
    userId: resolved.user.id,
    organizationId:
      typeof resolved.session.activeOrganizationId === "string"
        ? resolved.session.activeOrganizationId
        : undefined,
  });
}

// Resolve through auth.api so Better Auth applies its bearer and cookie handling.
export function createIdentityAuthHooks(
  resolveSession: (
    headers: Headers,
  ) => Promise<{ response: ResolvedSession | null; headers: Headers }>,
) {
  return {
    before: createAuthMiddleware(async (ctx) => {
      // The resolver itself calls this endpoint. Its after hook attributes the result.
      if (ctx.path === "/get-session" || !ctx.headers) return;
      if (!ctx.headers.has("cookie") && !ctx.headers.has("authorization"))
        return;
      const resolved = await resolveSession(ctx.headers).catch(() => null);
      if (!resolved) return;
      // Install immediately so plugin before hooks can reuse the session too.
      ctx.context.session = resolved.response;
      attributeSession(resolved.response);
      Object.assign(ctx.context, { telemetrySessionHeaders: resolved.headers });
    }),
    after: createAuthMiddleware(async (ctx) => {
      attributeSession(ctx.context.newSession ?? ctx.context.session);
      if (
        "telemetrySessionHeaders" in ctx.context &&
        ctx.context.telemetrySessionHeaders instanceof Headers
      ) {
        ctx.context.responseHeaders ??= new Headers();
        const responseHeaders = ctx.context.responseHeaders;
        // The endpoint's cookies take precedence, especially when signing out.
        const names = new Set(
          responseHeaders.getSetCookie().map((cookie) => cookie.split("=")[0]),
        );
        for (const cookie of ctx.context.telemetrySessionHeaders.getSetCookie()) {
          if (!names.has(cookie.split("=")[0]))
            responseHeaders.append("set-cookie", cookie);
        }
      }
    }),
  };
}
