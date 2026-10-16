import { assertStorageReady } from "@app/storage-readiness";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { db } from "@/db/client";
import {
  assertOrganizationTarget,
  organizationTargetErrorResponse,
} from "@/lib/cli-target";
import { findOrganizationForMember } from "@/lib/organization-membership.server";
import { isOrganizationAdmin } from "@/lib/organization-role";
import { getSession } from "@/lib/session.server";
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
  .server(async ({ request, next, context: { session } }) => {
    const activeOrgId = session.session.activeOrganizationId;
    if (!activeOrgId) {
      throw new Error("No active organization");
    }
    try {
      assertOrganizationTarget(request.headers, activeOrgId);
    } catch (error) {
      throw organizationTargetErrorResponse(error) ?? error;
    }

    const membership = await findOrganizationForMember(
      db,
      session.user.id,
      activeOrgId,
    );
    if (!membership) throw new Error("Not a member of the active organization");
    const { memberRole, ...organization } = membership;

    return next({
      context: {
        organization,
        memberRole,
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
    assertStorageReady(organization.metadata);
    return next();
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
export const createPartiallyAuthenticatedServerFn = createServerFn().middleware(
  [authMiddleware],
);
