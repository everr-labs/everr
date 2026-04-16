import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { auth } from "@/lib/auth.server";
import { createClickhouseQuery } from "./clickhouse";

export const authMiddleware = createMiddleware().server(
  async ({ request, next }) => {
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
  },
);

export const requireOrgMiddleware = createMiddleware()
  .middleware([authMiddleware])
  .server(async ({ next, context: { session } }) => {
    const activeOrgId = session.session.activeOrganizationId;
    if (!activeOrgId) {
      throw new Error("No active organization");
    }

    return next({
      context: {
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

export const createAuthenticatedServerFn = createServerFn().middleware([
  requireOrgMiddleware,
]);

/**
 * A server function that is authenticated but not necessarily has an active organization.
 * This is useful for routes or function that need to be authenticated but not necessarily have an
 * active organization yet, such as the onboarding flow.
 */
export const createPartiallyAuthenticatedServerFn = createServerFn().middleware(
  [authMiddleware],
);
