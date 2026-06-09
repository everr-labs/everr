import { createMiddleware } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { organization } from "@/db/schema";
import { auth } from "@/lib/auth.server";
import { createClickhouseQuery } from "@/lib/clickhouse";

export interface ApplyAuth {
  organizationId: string;
  organizationName: string;
  /** Audit principal, e.g. "apikey:<keyId>" or "user:<userId>". */
  principalId: string;
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
 * session-gated `getFullOrganization` endpoint, so it works on the ingest-key
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
 *  - an organization-scoped ingest key (prefix `ek_`): org from the key.
 *  - a logged-in session bearer token: org from the session's active org.
 * The `ek_` prefix decides the path so a session token never hits verifyApiKey.
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
    const organizationId = result.key.referenceId;
    return {
      organizationId,
      organizationName: await organizationName(organizationId),
      principalId: `apikey:${result.key.id}`,
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
  };
}

/**
 * Build the org-scoped server-fn context from resolved apply auth. Pure and
 * framework-free so it can be unit-tested. Exposes the resolved org both as the
 * active org and as `context.organization` (for the apply response echo).
 */
export function buildApplyContext(apiAuth: ApplyAuth) {
  return {
    session: {
      session: { activeOrganizationId: apiAuth.organizationId },
      user: { id: apiAuth.principalId },
    },
    organization: {
      id: apiAuth.organizationId,
      name: apiAuth.organizationName,
    },
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
