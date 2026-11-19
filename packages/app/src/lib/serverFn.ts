import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { resolveOrganizationAccess, resolveSession } from "#app/lib/org-session.server.ts";
import { isOrganizationAdmin } from "#app/lib/organization-role.ts";
import { createOrganizationSql } from "#app/lib/organization-sql.ts";
import { createClickhouseQuery } from "./clickhouse";

const authMiddleware = createMiddleware().server(async ({ request, next }) =>
  next({ context: { session: await resolveSession(request.headers) } }),
);

export const requireOrgMiddleware = createMiddleware()
  .middleware([authMiddleware])
  .server(async ({ next, context: { session } }) => {
    const access = await resolveOrganizationAccess(session);
    return next({
      context: {
        ...access,
        clickhouse: {
          query: createClickhouseQuery(access.organization.id),
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
