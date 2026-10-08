import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { assertOrganizationProvisioned } from "@/common/organization-provisioning";
import { db } from "@/db/client";
import { member, organization as organizationTable } from "@/db/schema";
import { auth } from "@/lib/auth.server";
import { isOrganizationAdmin } from "@/lib/organization-role";
import { createClickhouseQuery } from "./clickhouse";

const authMiddleware = createMiddleware().server(async ({ request, next }) => {
  const session = await auth.api.getSession({
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

    const [organization] = await db
      .select({
        id: organizationTable.id,
        metadata: organizationTable.metadata,
      })
      .from(organizationTable)
      .innerJoin(member, eq(member.organizationId, organizationTable.id))
      .where(
        and(
          eq(organizationTable.id, activeOrgId),
          eq(member.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!organization)
      throw new Error("Not a member of the active organization");

    return next({
      context: {
        organization,
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

const requireProvisionedOrgMiddleware = createMiddleware()
  .middleware([requireOrgMiddleware])
  .server(({ next, context: { organization } }) => {
    assertOrganizationProvisioned(organization.metadata);
    return next();
  });

export const createAuthenticatedServerFn = createServerFn().middleware([
  requireProvisionedOrgMiddleware,
]);

export class NotOrganizationAdminError extends Error {
  name = "NotOrganizationAdminError";

  constructor() {
    super("Not authorized");
  }
}

const requireOrganizationAdminMiddleware = createMiddleware()
  .middleware([requireOrgMiddleware])
  .server(async ({ request, next, context: { session } }) => {
    const { role } = await auth.api.getActiveMemberRole({
      headers: request.headers,
    });
    if (!isOrganizationAdmin(role)) {
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
export const createPartiallyAuthenticatedServerFn = createServerFn().middleware(
  [authMiddleware],
);
