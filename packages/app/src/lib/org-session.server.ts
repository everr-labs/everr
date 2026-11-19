import { db } from "#app/db/client.ts";
import { findOrganizationForMember } from "#app/lib/organization-membership.server.ts";
import { getSession } from "#app/lib/session.server.ts";

/** An auth failure that carries the HTTP status a route should answer with. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
  }
}

export function authErrorResponse(error: AuthError): Response {
  return Response.json({ error: error.message }, { status: error.status });
}

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

export async function resolveSession(headers: Headers): Promise<Session> {
  const session = await getSession({ headers });
  if (!session?.session || !session?.user) {
    throw new AuthError("Unauthenticated", 401);
  }
  return session;
}

/**
 * Checks that the session's active organization is one the user still belongs
 * to: the session keeps its active organization after the user is removed.
 */
export async function resolveOrganizationAccess({ session, user }: Session) {
  const activeOrgId = session.activeOrganizationId;
  if (!activeOrgId) {
    throw new AuthError("No active organization", 403);
  }

  const membership = await findOrganizationForMember(db, user.id, activeOrgId);
  if (!membership) {
    throw new AuthError("Not a member of the active organization", 403);
  }
  const { memberRole, ...organization } = membership;

  return {
    organization,
    memberRole,
    session: {
      session: { ...session, activeOrganizationId: activeOrgId },
      user,
    },
  };
}

export async function resolveOrgSession(headers: Headers) {
  return resolveOrganizationAccess(await resolveSession(headers));
}
