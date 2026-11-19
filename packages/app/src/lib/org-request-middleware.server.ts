import { createMiddleware } from "@tanstack/react-start";
import { AuthError, authErrorResponse, resolveOrgSession } from "#app/lib/org-session.server.ts";

// For server routes. A throw there becomes a 500, so auth failures are
// answered with their status instead; the CLI keys on 401 to ask for a login.
export const requireOrgRequestMiddleware = createMiddleware({ type: "request" }).server(
  async ({ request, next }) => {
    let access: Awaited<ReturnType<typeof resolveOrgSession>>;
    try {
      access = await resolveOrgSession(request.headers);
    } catch (error) {
      if (error instanceof AuthError) return authErrorResponse(error);
      throw error;
    }
    return next({ context: access });
  },
);
