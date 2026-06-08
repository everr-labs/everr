import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { type ApplyAuth, resolveApplyAuth } from "@/data/dashboards/apply-auth";
import { auth } from "@/lib/auth.server";
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

/**
 * Build the org-scoped server-fn context from either a resolved API key or an
 * interactive session. Pure and framework-free so it can be unit-tested.
 * Throws when neither path yields an active organization.
 */
export function buildApplyContext(
  apiAuth: ApplyAuth | null,
  session: Awaited<ReturnType<typeof auth.api.getSession>>,
) {
  if (apiAuth) {
    return {
      session: {
        session: { activeOrganizationId: apiAuth.organizationId },
        user: { id: apiAuth.principalId },
      },
      clickhouse: { query: createClickhouseQuery(apiAuth.organizationId) },
    };
  }
  if (!session?.session || !session?.user) {
    throw new Error("Unauthenticated");
  }
  const activeOrgId = session.session.activeOrganizationId;
  if (!activeOrgId) {
    throw new Error("No active organization");
  }
  return {
    session: {
      session: { ...session.session, activeOrganizationId: activeOrgId },
      user: session.user,
    },
    clickhouse: { query: createClickhouseQuery(activeOrgId) },
  };
}

/**
 * Authorize a dashboards apply: prefer an API key (CI/gitops), fall back to the
 * interactive session+org. Same context shape as requireOrgMiddleware.
 */
export const requireOrgOrApiKeyMiddleware = createMiddleware().server(
  async ({ request, next }) => {
    const apiAuth = await resolveApplyAuth(request.headers);
    const session = apiAuth
      ? null
      : await auth.api.getSession({ headers: request.headers });
    return next({ context: buildApplyContext(apiAuth, session) });
  },
);
