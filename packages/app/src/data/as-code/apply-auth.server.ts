import { createMiddleware } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { parseAlertingPrincipal } from "@/data/alerting/session";
import { db } from "@/db/client";
import { organization } from "@/db/schema";
import { hasApiKeyScope } from "@/lib/api-key-scopes";
import { auth } from "@/lib/auth.server";
import { createClickhouseQuery } from "@/lib/clickhouse";

export interface ApplyAuth {
  organizationId: string;
  organizationName: string;
  /** Audit principal, e.g. "apikey:<keyId>" or "user:<userId>". */
  principalId: string;
  /**
   * Actions the principal holds under the `apply` scope, or `null` when the
   * request is session-authenticated (sessions have no per-action
   * restriction). For API keys this is `permissions.apply`; the middleware's
   * holds-scope gate guarantees a non-null value here has at least one entry
   * (possibly the wildcard `"*"`). The handler checks `canApplyMutate` on the
   * `dryRun: false` path so a read-only key can plan but not write.
   */
  applyActions: readonly string[] | null;
}

/** Sentinel that grants every action under a scope. */
const WILDCARD = "*";

/**
 * Can the principal perform a mutative apply (`dryRun: false`)? Sessions are
 * unrestricted. API keys must hold `write` (or the wildcard) under the
 * `apply` scope — a `read`-only key can only run the plan pass.
 */
export function canApplyMutate(
  applyActions: readonly string[] | null,
): boolean {
  if (applyActions === null) return true;
  return applyActions.includes(WILDCARD) || applyActions.includes("write");
}

/** Pull a credential from `Authorization: Bearer <v>` or `x-api-key`. */
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
 * Look up the org's display name directly from the DB. This avoids the
 * session-gated `getFullOrganization` endpoint, so it works on the API key
 * path (which has no session) too. Falls back to the id if the org isn't found.
 */
async function organizationName(organizationId: string): Promise<string> {
  const [row] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  return row?.name ?? organizationId;
}

/**
 * Resolve apply auth from request headers. Accepts two credentials:
 *  - an organization-scoped API key (prefix `ek_`): org from the key.
 *  - a logged-in session bearer token: org from the session's active org.
 * The `ek_` prefix decides the path so a session token never hits verifyApiKey.
 * API keys are additionally required to carry the `apply` scope — a key minted
 * for telemetry ingest only must not be able to mutate dashboards, runbooks,
 * or alerts even though both use the same `ek_` configId.
 */
export async function resolveApplyAuth(headers: Headers): Promise<ApplyAuth> {
  const credential = extractBearerKey(headers);
  if (!credential) throw new Error("Missing credential");

  if (credential.startsWith("ek_")) {
    const result = await auth.api.verifyApiKey({
      body: { key: credential, configId: "ingest" },
    });
    if (!result.valid || !result.key?.referenceId) {
      throw new Error("Invalid API key");
    }
    if (!hasApiKeyScope(result.key.permissions, "apply")) {
      throw new Error("API key is not authorized to apply resources");
    }
    const organizationId = result.key.referenceId;
    return {
      organizationId,
      organizationName: await organizationName(organizationId),
      principalId: `apikey:${result.key.id}`,
      applyActions: result.key.permissions?.apply ?? [],
    };
  }

  const session = await auth.api.getSession({ headers });
  if (!session?.session || !session?.user) {
    throw new Error("Unauthenticated");
  }
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) {
    throw new Error("No active organization");
  }
  return {
    organizationId,
    organizationName: await organizationName(organizationId),
    principalId: `user:${session.user.id}`,
    applyActions: null,
  };
}

/**
 * Build the org-scoped server-fn context from resolved apply auth. Pure and
 * framework-free so it can be unit-tested. Exposes the resolved org both as the
 * active org and as `context.organization` (for the apply response echo).
 *
 * `session.principalId` is what tells the alerting session boundary that
 * `user.id` holds a principal string (an API key has no user id) rather than a
 * user id, so the actor it derives names the right principal.
 */
export function buildApplyContext(apiAuth: ApplyAuth) {
  return {
    session: {
      session: { activeOrganizationId: apiAuth.organizationId },
      user: { id: apiAuth.principalId },
      principalId: apiAuth.principalId,
    },
    actor: parseAlertingPrincipal(apiAuth.principalId),
    organization: {
      id: apiAuth.organizationId,
      name: apiAuth.organizationName,
    },
    applyActions: apiAuth.applyActions,
    clickhouse: { query: createClickhouseQuery(apiAuth.organizationId) },
  };
}

/**
 * Map an auth failure thrown by `resolveApplyAuth` to an explicit HTTP response:
 * 401 for a missing/invalid/unauthenticated credential, 403 for an
 * authenticated principal with no active organization. Returns null for any
 * other error so genuine infrastructure failures still surface as a 500 (a bug
 * must not be masked as an auth rejection). The `{ error }` body mirrors the
 * route's other error shapes; the 401 status is what the CLI keys on to print
 * its apply-specific guidance instead of a generic server error.
 */
const AUTH_ERROR_STATUS: Record<string, number> = {
  "Missing credential": 401,
  "Invalid API key": 401,
  "API key is not authorized to apply resources": 403,
  Unauthenticated: 401,
  "No active organization": 403,
};

export function applyAuthErrorResponse(error: unknown): Response | null {
  const message = error instanceof Error ? error.message : "";
  const status = AUTH_ERROR_STATUS[message];
  if (!status) return null;
  return Response.json({ error: message }, { status });
}

/**
 * Authorize an apply request via an org-scoped ingest key (CI) OR a logged-in
 * session (interactive). The resolved org is exposed on the context. Auth
 * failures are returned as explicit 401/403 responses (thrown Responses are
 * sent by the server handler) rather than escaping as a generic 500.
 */
export const requireOrgOrApiKeyMiddleware = createMiddleware().server(
  async ({ request, next }) => {
    let apiAuth: ApplyAuth;
    try {
      apiAuth = await resolveApplyAuth(request.headers);
    } catch (error) {
      const response = applyAuthErrorResponse(error);
      if (response) throw response;
      throw error;
    }
    return next({ context: buildApplyContext(apiAuth) });
  },
);
