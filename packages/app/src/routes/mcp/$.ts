import { AsyncLocalStorage } from "node:async_hooks";
import { createFileRoute } from "@tanstack/react-router";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { SQL_API_TENANT_TABLES } from "@/lib/clickhouse";
import { assertCurrentMember, McpMembershipError } from "@/lib/mcp-membership";
import { AUTH_ISSUER, MCP_RESOURCE } from "@/lib/mcp-resource";
import { mcpResourceClient } from "@/lib/mcp-resource-client";
import { runSqlForConnection } from "@/lib/mcp-run-sql";

// Single source of truth: the tables the per-org ClickHouse role can read.
const READABLE_TABLES = SQL_API_TENANT_TABLES.join(", ");

// Per-request org context, taken from the verified `org_id` token claim.
const orgStore = new AsyncLocalStorage<{ orgId: string }>();

// Built ONCE at module load (ALS propagates through mcp-handler). Named
// `mcpTransport` to avoid clashing with the oauth-provider `mcpHandler` export.
const mcpTransport = createMcpHandler(
  (server) => {
    server.registerTool(
      "query",
      {
        description:
          `Run a read-only ClickHouse SQL query against your organization's ` +
          `telemetry. Readable tables: ${READABLE_TABLES}. Discover columns with ` +
          `"SELECT * FROM <table> LIMIT 1". Read-only; results are capped.`,
        inputSchema: { sql: z.string() },
      },
      async ({ sql }) => {
        const ctx = orgStore.getStore();
        if (!ctx) {
          return {
            isError: true,
            content: [{ type: "text", text: "No org context." }],
          };
        }
        const result = await runSqlForConnection({ orgId: ctx.orgId, sql });
        return {
          isError: result.isError,
          content: [{ type: "text", text: result.text }],
        };
      },
    );
  },
  {},
  { basePath: "", maxDuration: 60 },
);

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "WWW-Authenticate, mcp-session-id",
};

function unauthorized(request: Request): Response {
  const base = new URL(request.url).origin;
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "Unauthorized" },
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
        ...CORS_HEADERS,
      },
    },
  );
}

async function handler(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  const token = auth?.toLowerCase().startsWith("bearer ")
    ? auth.slice(7)
    : undefined;
  if (!token) return unauthorized(request);

  // Verify signature, audience, issuer, scope and expiry. Throws on any failure.
  let payload: Record<string, unknown>;
  try {
    payload = (await mcpResourceClient().verifyAccessToken(token, {
      // issuer/jwksUrl must be passed explicitly: the resource client derives
      // them from auth.options.baseURL, which omits the /api/auth mount path, so
      // it would otherwise check the wrong issuer and fetch BETTER_AUTH_URL/jwks
      // (404). AUTH_ISSUER is the real issuer the AS metadata + JWT `iss` use.
      jwksUrl: `${AUTH_ISSUER}/jwks`,
      verifyOptions: { audience: MCP_RESOURCE, issuer: AUTH_ISSUER },
      scopes: ["observability:read"],
    })) as Record<string, unknown>;
  } catch {
    return unauthorized(request); // bad sig/aud/iss/scope/expiry
  }

  // Read the consent-time org and the subject from the verified claims. Fail
  // closed (401) if either is missing rather than trusting a malformed token.
  const orgId = typeof payload.org_id === "string" ? payload.org_id : undefined;
  const userId = typeof payload.sub === "string" ? payload.sub : undefined;
  if (!orgId || !userId) return unauthorized(request);

  // Re-check membership at request time (revocation / removal after consent).
  try {
    await assertCurrentMember(userId, orgId);
  } catch (e) {
    if (e instanceof McpMembershipError) return unauthorized(request);
    throw e;
  }

  const res = await orgStore.run({ orgId }, () => mcpTransport(request));
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    if (!out.headers.has(k)) out.headers.set(k, v);
  }
  return out;
}

function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers":
        "authorization, content-type, mcp-session-id",
    },
  });
}

export const Route = createFileRoute("/mcp/$")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
      DELETE: ({ request }) => handler(request),
      OPTIONS: () => preflight(),
    },
  },
});
