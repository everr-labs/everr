// packages/app/src/data/as-code/apply-auth.server.ts
import { createMiddleware } from "@tanstack/react-start";
import { auth } from "@/lib/auth.server";
import { createClickhouseQuery } from "@/lib/clickhouse";

/**
 * API key configs accepted for `applyDashboards`, in priority order. Only the
 * org-referenced `ingest` key is accepted today. To add a user-referenced `cli`
 * key or a dedicated `deploy` key later, append an entry here — a user-referenced
 * config will also need an org-resolution branch in `resolveApplyAuth` (the
 * `references` field is the discriminator for that).
 */
const APPLY_KEY_CONFIGS: ReadonlyArray<{
  configId: string;
  references: "organization";
}> = [{ configId: "ingest", references: "organization" }];

export interface ApplyAuth {
  organizationId: string;
  /** Audit principal, e.g. "apikey:<keyId>". */
  principalId: string;
}

/** Pull an API key from `Authorization: Bearer <key>` or `x-api-key`. */
export function extractBearerKey(headers: Headers): string | null {
  const authHeader = headers.get("authorization");
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match?.[1]) return match[1].trim();
  }
  const apiKey = headers.get("x-api-key");
  return apiKey ? apiKey.trim() : null;
}

/**
 * Resolve apply auth from request headers. Returns null when no API key is
 * present (the caller should then fall back to interactive session auth).
 * Throws when a key IS present but invalid.
 */
export async function resolveApplyAuth(
  headers: Headers,
): Promise<ApplyAuth | null> {
  const key = extractBearerKey(headers);
  if (!key) return null;

  for (const config of APPLY_KEY_CONFIGS) {
    const result = await auth.api.verifyApiKey({
      body: { key, configId: config.configId },
    });
    if (!result.valid || !result.key?.referenceId) continue;
    // Only org-referenced configs are in the list today, so referenceId is the
    // organization id.
    return {
      organizationId: result.key.referenceId,
      principalId: `apikey:${result.key.id}`,
    };
  }

  throw new Error("Invalid API key");
}

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
 * Authorize an apply request: prefer an API key (CI/gitops), fall back to the
 * interactive session+org. Same context shape as requireOrgMiddleware. Scoped
 * to the `/api/apply` route — kept out of the shared `serverFn.ts` so its
 * server-only imports never reach the client bundle.
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
