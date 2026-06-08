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
 * Resolve apply auth from request headers. Apply is token-only: it accepts an
 * organization-scoped ingest key and nothing else — interactive sessions and
 * user-scoped keys are rejected (the latter fail `verifyApiKey` for the
 * org-referenced `ingest` config). Throws when no key is present or it's invalid.
 */
export async function resolveApplyAuth(headers: Headers): Promise<ApplyAuth> {
  const key = extractBearerKey(headers);
  if (!key) throw new Error("Missing API key");

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
 * Build the org-scoped server-fn context from a resolved API key. Pure and
 * framework-free so it can be unit-tested.
 */
export function buildApplyContext(apiAuth: ApplyAuth) {
  return {
    session: {
      session: { activeOrganizationId: apiAuth.organizationId },
      user: { id: apiAuth.principalId },
    },
    clickhouse: { query: createClickhouseQuery(apiAuth.organizationId) },
  };
}

/**
 * Authorize an apply request via an organization-scoped API key (CI/gitops).
 * Interactive sessions are not accepted — apply only ever runs under a token.
 * Same context shape as requireOrgMiddleware. Scoped to the `/api/apply` route —
 * kept out of the shared `serverFn.ts` so its server-only imports never reach
 * the client bundle.
 */
export const requireOrgOrApiKeyMiddleware = createMiddleware().server(
  async ({ request, next }) => {
    const apiAuth = await resolveApplyAuth(request.headers);
    return next({ context: buildApplyContext(apiAuth) });
  },
);
