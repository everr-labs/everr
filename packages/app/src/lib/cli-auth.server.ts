import { createMiddleware } from "@tanstack/react-start";
import { db } from "#app/db/client.ts";
import { findOrganizationForMember } from "#app/lib/organization-membership.server.ts";
import { getSession } from "#app/lib/session.server.ts";

// Unlike the server-fn middleware, this answers auth failures with a status
// instead of throwing: a throw in a server route becomes a 500, and the CLI
// keys on 401 to tell the user to log in again.
export const requireCliOrgMiddleware = createMiddleware({ type: "request" }).server(
  async ({ request, next }) => {
    const session = await getSession({ headers: request.headers });
    if (!session?.session || !session?.user) {
      return Response.json({ error: "Unauthenticated" }, { status: 401 });
    }

    const activeOrgId = session.session.activeOrganizationId;
    if (!activeOrgId) {
      return Response.json({ error: "No active organization" }, { status: 403 });
    }

    const membership = await findOrganizationForMember(db, session.user.id, activeOrgId);
    if (!membership) {
      return Response.json({ error: "Not a member of the active organization" }, { status: 403 });
    }
    const { memberRole: _, ...organization } = membership;

    return next({
      context: {
        organization,
        session: {
          session: { ...session.session, activeOrganizationId: activeOrgId },
          user: session.user,
        },
      },
    });
  },
);
