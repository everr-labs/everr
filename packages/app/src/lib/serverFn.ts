import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { db } from "#app/db/client.ts";
import { findOrganizationForMember } from "#app/lib/organization-membership.server.ts";
import { isOrganizationAdmin } from "#app/lib/organization-role.ts";
import { createOrganizationSql } from "#app/lib/organization-sql.ts";
import { getSession } from "#app/lib/session.server.ts";
import { createClickhouseQuery } from "./clickhouse";

const authMiddleware = createMiddleware().server(async ({ request, next }) => {
  const session = await getSession({
    headers: request.headers,
  });

  if (!session?.session || !session?.user) {
    throw new Error("Unauthenticated");
  }

  return next({
    context: {
      session,
    },
  });
});

export const requireOrgMiddleware = createMiddleware()
  .middleware([authMiddleware])
  .server(async ({ next, context: { session } }) => {
    const activeOrgId = session.session.activeOrganizationId;
    if (!activeOrgId) {
      throw new Error("No active organization");
    }

    const membership = await findOrganizationForMember(db, session.user.id, activeOrgId);
    if (!membership) throw new Error("Not a member of the active organization");
    const { memberRole, membershipId, ...organization } = membership;

    return next({
      context: {
        organization,
        memberRole,
        consultationPrincipal: {
          kind: "member" as const,
          organizationId: activeOrgId,
          userId: session.user.id,
          membershipId,
        },
        session: {
          session: {
            ...session.session,
            activeOrganizationId: activeOrgId,
          },
          user: session.user,
        },
        clickhouse: {
          query: createClickhouseQuery(activeOrgId),
        },
      },
    });
  });

const requireStorageReadyMiddleware = createMiddleware()
  .middleware([requireOrgMiddleware])
  .server(({ next, context: { organization } }) => {
    return next({
      context: {
        sql: createOrganizationSql(organization.id, organization.metadata),
      },
    });
  });

export const createAuthenticatedServerFn = createServerFn().middleware([
  requireStorageReadyMiddleware,
]);

export class NotOrganizationAdminError extends Error {
  name = "NotOrganizationAdminError";

  constructor() {
    super("Not authorized");
  }
}

const requireOrganizationAdminMiddleware = createMiddleware()
  .middleware([requireOrgMiddleware])
  .server(({ next, context: { session, memberRole } }) => {
    if (!isOrganizationAdmin(memberRole)) {
      throw new NotOrganizationAdminError();
    }

    return next({
      context: { orgId: session.session.activeOrganizationId },
    });
  });

export const createOrganizationAdminServerFn = createServerFn().middleware([
  requireOrganizationAdminMiddleware,
]);

/**
 * A server function that is authenticated but not necessarily has an active organization.
 * This is useful for routes or function that need to be authenticated but not necessarily have an
 * active organization yet, such as organization selection and creation.
 */
export const createPartiallyAuthenticatedServerFn = createServerFn().middleware([authMiddleware]);
