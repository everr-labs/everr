import { createMiddleware, createServerFn } from "@tanstack/react-start";
import {
  assertExpectedOrganization,
  resolveOrganizationAccess,
  resolveSession,
} from "#app/lib/org-session.server.ts";
import { isOrganizationAdmin, NotOrganizationAdminError } from "#app/lib/organization-role.ts";
import { createOrganizationSql } from "#app/lib/organization-sql.ts";
import { createClickhouseQuery } from "./clickhouse";

const authMiddleware = createMiddleware().server(async ({ request, next }) =>
  next({ context: { session: await resolveSession(request.headers) } }),
);

function organizationMiddleware(options: { allowSuspended: boolean }) {
  return createMiddleware()
    .middleware([authMiddleware])
    .server(async ({ request, next, context: { session } }) => {
      const access = await resolveOrganizationAccess(session, options);
      assertExpectedOrganization(request.headers, access.organization.id);
      return next({
        context: {
          ...access,
          clickhouse: {
            query: createClickhouseQuery(access.organization.id),
          },
        },
      });
    });
}

export const requireOrgMiddleware = organizationMiddleware({ allowSuspended: false });

/**
 * Also admits an organization whose subscription is suspended. Only for what it
 * needs to restore access: billing, and the policy that tells the app it is
 * suspended.
 */
export const requireOrgAllowingSuspendedMiddleware = organizationMiddleware({
  allowSuspended: true,
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

export { NotOrganizationAdminError };

function organizationAdminMiddleware(orgMiddleware: typeof requireOrgMiddleware) {
  return createMiddleware()
    .middleware([orgMiddleware])
    .server(({ next, context: { session, memberRole } }) => {
      if (!isOrganizationAdmin(memberRole)) {
        throw new NotOrganizationAdminError();
      }

      return next({
        context: { orgId: session.session.activeOrganizationId },
      });
    });
}

export const createOrganizationAdminServerFn = createServerFn().middleware([
  organizationAdminMiddleware(requireOrgMiddleware),
]);

/** Admin functions a suspended organization needs to restore access, such as billing. */
export const createOrganizationAdminAllowingSuspendedServerFn = createServerFn().middleware([
  organizationAdminMiddleware(requireOrgAllowingSuspendedMiddleware),
]);

/**
 * A server function that is authenticated but not necessarily has an active organization.
 * This is useful for routes or function that need to be authenticated but not necessarily have an
 * active organization yet, such as organization selection and creation.
 */
export const createPartiallyAuthenticatedServerFn = createServerFn().middleware([authMiddleware]);
