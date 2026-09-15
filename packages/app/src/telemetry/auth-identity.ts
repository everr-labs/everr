import { createAuthMiddleware } from "better-auth/api";
import { setTelemetryIdentity } from "./identity";

/** Observe Better Auth's resolved session without another authentication lookup. */
export const identityAuthHooks = {
  after: createAuthMiddleware(async (ctx) => {
    const resolved = ctx.context.newSession ?? ctx.context.session;
    if (
      !resolved ||
      new Date(resolved.session.expiresAt).getTime() <= Date.now()
    ) {
      return;
    }
    const organizationId =
      "activeOrganizationId" in resolved.session
        ? resolved.session.activeOrganizationId
        : undefined;
    setTelemetryIdentity({
      userId: resolved.user.id,
      organizationId:
        typeof organizationId === "string" ? organizationId : undefined,
    });
  }),
};
