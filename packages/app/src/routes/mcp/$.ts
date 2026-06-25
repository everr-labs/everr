import { createFileRoute } from "@tanstack/react-router";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { SQL_API_TENANT_TABLES } from "@/lib/clickhouse";
import { getMcpIdentity } from "@/lib/mcp-identity";
import { assertCurrentMember } from "@/lib/mcp-membership";
import { AUTH_ISSUER, MCP_RESOURCE } from "@/lib/mcp-resource";
import { mcpResourceClient } from "@/lib/mcp-resource-client";
import { runSqlForConnection } from "@/lib/mcp-run-sql";

// Single source of truth: the tables the per-org ClickHouse role can read.
const READABLE_TABLES = SQL_API_TENANT_TABLES.join(", ");

// Per-request identity, carried on the verified token's AuthInfo.extra. The MCP
// SDK threads AuthInfo into every tool call's `extra`, so there's no need to
// thread it through the handler or stash it in AsyncLocalStorage ourselves.
type McpContext = { orgId: string; userId: string };

function contextOf(extra: { authInfo?: { extra?: Record<string, unknown> } }) {
  const ctx = extra.authInfo?.extra as McpContext | undefined;
  return ctx?.orgId && ctx?.userId ? ctx : undefined;
}

// Built ONCE at module load. Named `mcpTransport` to avoid clashing with the
// oauth-provider `mcpHandler` export.
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
      async ({ sql }, extra) => {
        const ctx = contextOf(extra);
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

    server.registerTool(
      "whoami",
      {
        description:
          "Return the authenticated user and the organization this connection " +
          "is scoped to (its telemetry is what `query` reads).",
        inputSchema: {},
      },
      async (_args, extra) => {
        const ctx = contextOf(extra);
        if (!ctx) {
          return {
            isError: true,
            content: [{ type: "text", text: "No identity context." }],
          };
        }
        const identity = await getMcpIdentity(ctx.userId, ctx.orgId);
        if (!identity) {
          return {
            isError: true,
            content: [{ type: "text", text: "Identity not found." }],
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(identity, null, 2) }],
        };
      },
    );
  },
  {},
  { basePath: "", maxDuration: 60 },
);

// Verify the bearer token and surface the org/user to tools via AuthInfo.extra.
// Returning undefined (or throwing) makes withMcpAuth answer 401 with the
// resource-metadata challenge.
async function verifyToken(_req: Request, bearerToken?: string) {
  if (!bearerToken) return undefined;

  let payload: Record<string, unknown>;
  try {
    // issuer/jwksUrl must be passed explicitly: the resource client derives them
    // from auth.options.baseURL, which omits the /api/auth mount path, so it
    // would otherwise check the wrong issuer and fetch BETTER_AUTH_URL/jwks (404).
    payload = (await mcpResourceClient().verifyAccessToken(bearerToken, {
      jwksUrl: `${AUTH_ISSUER}/jwks`,
      verifyOptions: { audience: MCP_RESOURCE, issuer: AUTH_ISSUER },
      scopes: ["observability:read"],
    })) as Record<string, unknown>;
  } catch {
    return undefined; // bad sig/aud/iss/scope/expiry
  }

  const orgId = typeof payload.org_id === "string" ? payload.org_id : undefined;
  const userId = typeof payload.sub === "string" ? payload.sub : undefined;
  if (!orgId || !userId) return undefined;

  // Re-check membership at request time (revocation / removal after consent).
  // A non-member throws McpMembershipError -> withMcpAuth answers 401.
  await assertCurrentMember(userId, orgId);

  return {
    token: bearerToken,
    clientId: typeof payload.azp === "string" ? payload.azp : "",
    scopes:
      typeof payload.scope === "string"
        ? payload.scope.split(" ")
        : ["observability:read"],
    expiresAt: typeof payload.exp === "number" ? payload.exp : undefined,
    extra: { orgId, userId } satisfies McpContext,
  };
}

const authedTransport = withMcpAuth(mcpTransport, verifyToken, {
  required: true,
  requiredScopes: ["observability:read"],
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

// Browser-based MCP clients (e.g. the MCP Inspector) hit /mcp cross-origin, so
// every response — including withMcpAuth's 401 challenge — needs CORS, and the
// WWW-Authenticate / mcp-session-id headers must be exposed for the client to
// read the auth challenge and track its session. Native clients ignore this.
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "WWW-Authenticate, mcp-session-id",
};

async function handler(request: Request): Promise<Response> {
  const res = await authedTransport(request);
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
