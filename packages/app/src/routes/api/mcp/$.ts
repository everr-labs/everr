import { AsyncLocalStorage } from "node:async_hooks";
import { createFileRoute } from "@tanstack/react-router";
import { withMcpAuth } from "better-auth/plugins";
// Use the export name Task 0 confirmed. mcp-handler@1.1.0 exports
// `createMcpRouteHandler`; older docs/`@vercel/mcp-adapter` use `createMcpHandler`.
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { auth } from "@/lib/auth.server";
import { runSqlForConnection } from "@/lib/mcp-run-sql";

const READABLE_TABLES =
  "traces, logs, metrics_gauge, metrics_sum, metrics_histogram, " +
  "metrics_exponential_histogram, metrics_summary";
const REQUIRED_SCOPE = "observability:read";

const userStore = new AsyncLocalStorage<{ userId: string }>();

// Built ONCE at module load (Task 0 proved ALS propagates through mcp-handler).
const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "run_sql",
      {
        description:
          `Run a read-only ClickHouse SQL query against your organization's ` +
          `telemetry. Readable tables: ${READABLE_TABLES}. Discover columns with ` +
          `"SELECT * FROM <table> LIMIT 1". Read-only; results are capped.`,
        inputSchema: { sql: z.string() },
      },
      async ({ sql }) => {
        const ctx = userStore.getStore();
        if (!ctx) {
          return {
            isError: true,
            content: [{ type: "text", text: "No user context." }],
          };
        }
        const result = await runSqlForConnection({ userId: ctx.userId, sql });
        return {
          isError: result.isError,
          content: [{ type: "text", text: result.text }],
        };
      },
    );
  },
  {},
  { basePath: "/api", maxDuration: 60 },
);

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
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "WWW-Authenticate",
      },
    },
  );
}

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "WWW-Authenticate, mcp-session-id",
};

// withMcpAuth returns its own 401 (with WWW-Authenticate) when there is no token.
// When a token IS present, our callback runs; getMcpSession checks neither scope
// nor expiry, so we do it here. Treat a missing/invalid expiry as expired (the
// column is nullable) rather than letting it pass.
const authed = withMcpAuth(auth, async (req, session) => {
  const scopes = (session.scopes ?? "").split(/\s+/).filter(Boolean);
  const expiresAt = new Date(
    session.accessTokenExpiresAt as unknown as string | Date,
  );
  const expired =
    !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now();
  if (expired || !scopes.includes(REQUIRED_SCOPE) || !session.userId) {
    return unauthorized(req);
  }
  return userStore.run({ userId: session.userId }, () => mcpHandler(req));
});

// Add CORS to EVERY response — withMcpAuth's own no-token 401 and successful
// tool responses don't set it, and browser-based clients (e.g. the Inspector)
// need it for discovery + tool calls.
async function handler(request: Request): Promise<Response> {
  const res = await authed(request);
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

export const Route = createFileRoute("/api/mcp/$")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
      DELETE: ({ request }) => handler(request),
      OPTIONS: () => preflight(),
    },
  },
});
