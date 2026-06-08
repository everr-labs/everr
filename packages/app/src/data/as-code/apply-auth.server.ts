import { createMiddleware } from "@tanstack/react-start";
import { auth } from "@/lib/auth.server";
import { createClickhouseQuery } from "@/lib/clickhouse";

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

  const result = await auth.api.verifyApiKey({
    // We only accept the `ingest` config today, which is org-referenced.
    // TODO: Add a separate "write" API key config for org-scoped write access
    // and deprecate `ingest`.
    body: { key, configId: "ingest" },
  });

  if (!result.valid || !result.key?.referenceId)
    throw new Error("Invalid API key");

  // Only org-referenced configs are in the list today, so referenceId is the organization id.
  return {
    organizationId: result.key.referenceId,
    principalId: `apikey:${result.key.id}`,
  };
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
 */
export const requireOrgOrApiKeyMiddleware = createMiddleware().server(
  async ({ request, next }) => {
    const apiAuth = await resolveApplyAuth(request.headers);
    return next({ context: buildApplyContext(apiAuth) });
  },
);
