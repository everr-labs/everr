import { createMiddleware } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { extractBearerKey } from "#app/data/as-code/apply-auth.server.ts";
import { db } from "#app/db/client.ts";
import { organization } from "#app/db/schema/index.ts";
import { auth } from "#app/identity/server.ts";
import { hasApiKeyScope } from "#app/lib/api-key-scopes.ts";
import { getSession } from "#app/lib/session.server.ts";
import { mergeTelemetryIdentity } from "#app/telemetry/identity.ts";

type QueryAuth = { organizationId: string; organizationMetadata: unknown };

class QueryAuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Who may query telemetry: an organization API key holding the `query`
 * capability, for an agent or a CI job without a browser to log in with, or
 * a logged-in session. A key minted to send telemetry or to apply resources
 * reads nothing.
 */
export async function resolveQueryAuth(headers: Headers): Promise<QueryAuth> {
  const credential = extractBearerKey(headers);
  if (!credential) throw new QueryAuthError("Missing credential", 401);
  let organizationId: string;
  if (credential.startsWith("ek_")) {
    const result = await auth.api.verifyApiKey({
      body: { key: credential, configId: "ingest" },
    });
    if (!result.valid || !result.key?.referenceId) {
      throw new QueryAuthError("Invalid API key", 401);
    }
    if (!hasApiKeyScope(result.key.permissions, "query", "read")) {
      throw new QueryAuthError("API key is not authorized to query telemetry", 403);
    }
    organizationId = result.key.referenceId;
  } else {
    const session = await getSession({ headers });
    if (!session?.session || !session.user) throw new QueryAuthError("Unauthenticated", 401);
    const active = session.session.activeOrganizationId;
    if (!active) throw new QueryAuthError("No active organization", 403);
    organizationId = active;
  }
  const [row] = await db
    .select({ metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  if (!row) throw new QueryAuthError("Organization not found", 403);
  mergeTelemetryIdentity({ organizationId });
  return { organizationId, organizationMetadata: row.metadata };
}

export const requireOrgOrQueryKeyMiddleware = createMiddleware().server(
  async ({ request, next }) => {
    let queryAuth: QueryAuth;
    try {
      queryAuth = await resolveQueryAuth(request.headers);
    } catch (error) {
      if (error instanceof QueryAuthError) {
        throw Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
    return next({ context: queryAuth });
  },
);
