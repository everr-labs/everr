import { product } from "@composition/product";
import { db } from "#app/db/client.ts";
import { findOrganizationForMember } from "#app/lib/organization-membership.server.ts";
import { getSession } from "#app/lib/session.server.ts";
import {
  EXPECTED_ORGANIZATION_HEADER,
  ORGANIZATION_CHANGED,
} from "#app/lib/expected-organization.ts";

/** An auth failure that carries the HTTP status a route should answer with. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 409,
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

export async function isOrganizationSuspended(organizationId: string) {
  return (await product.forOrganization(organizationId)).access === "suspended";
}

/**
 * A suspended organization keeps only what restores its access (billing). Read
 * on every request, not cached: a cached "suspended" would keep blocking right
 * after the subscription is paid.
 */
export async function assertOrganizationNotSuspended(organizationId: string) {
  if (await isOrganizationSuspended(organizationId)) {
    throw new AuthError("Organization suspended", 403);
  }
}

/**
 * Checks that the session's active organization is one the user still belongs
 * to: the session keeps its active organization after the user is removed.
 * `allowSuspended` is for what a suspended organization needs to restore access.
 */
export async function resolveOrganizationAccess(
  { session, user }: Session,
  { allowSuspended = false }: { allowSuspended?: boolean } = {},
) {
  const activeOrgId = session.activeOrganizationId;
  if (!activeOrgId) {
    throw new AuthError("No active organization", 403);
  }

  const membership = await findOrganizationForMember(db, user.id, activeOrgId);
  if (!membership) {
    throw new AuthError("Not a member of the active organization", 403);
  }
  const { memberRole, ...organization } = membership;
  if (!allowSuspended) await assertOrganizationNotSuspended(organization.id);

  return {
    organization,
    memberRole,
    session: {
      session: { ...session, activeOrganizationId: activeOrgId },
      user,
    },
  };
}

/** Refuses a request from a page that shows another organization than the session's. */
export function assertExpectedOrganization(headers: Headers, organizationId: string) {
  const expected = headers.get(EXPECTED_ORGANIZATION_HEADER);
  if (expected && expected !== organizationId) throw new AuthError(ORGANIZATION_CHANGED, 409);
}

export async function resolveOrgSession(headers: Headers) {
  return resolveOrganizationAccess(await resolveSession(headers));
}
