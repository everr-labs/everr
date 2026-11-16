import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { isLoopbackRedirectUri } from "#app/lib/mcp-redirect-uri.ts";

type RedirectAllowlistEntry = { kind: "exact"; href: string } | { kind: "prefix"; href: string };
export type RedirectAllowlist = readonly RedirectAllowlistEntry[];

const ENV_NAME = "MCP_OAUTH_ALLOWED_REDIRECT_URIS";

export const DEFAULT_MCP_REDIRECT_ALLOWLIST = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://chatgpt.com/connector/oauth/*",
  "https://vscode.dev/redirect",
  "https://insiders.vscode.dev/redirect",
  "https://www.cursor.com/agents/mcp/oauth/callback",
  "cursor://anysphere.cursor-mcp/oauth/callback",
].join(",");

function parseEntry(entry: string): RedirectAllowlistEntry {
  const fail = (reason: string) => new Error(`Invalid ${ENV_NAME} entry "${entry}": ${reason}`);
  const kind = entry.endsWith("/*") ? "prefix" : "exact";
  const url = kind === "prefix" ? entry.slice(0, -1) : entry;
  if (url.includes("*")) throw fail('"*" is only allowed as a trailing "/*"');
  let href: string;
  try {
    href = new URL(url).href;
  } catch {
    throw fail("not a URL");
  }
  if (kind === "prefix" && !href.endsWith("/")) throw fail('a prefix must end in "/*"');
  return { kind, href };
}

export function parseRedirectAllowlist(raw: string): RedirectAllowlist {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseEntry);
}

export function isAllowedRedirectUri(uri: string, allowlist: RedirectAllowlist): boolean {
  let href: string;
  try {
    href = new URL(uri).href;
  } catch {
    return false;
  }
  if (isLoopbackRedirectUri(uri)) return true;
  return allowlist.some((entry) =>
    entry.kind === "exact" ? href === entry.href : href.startsWith(entry.href),
  );
}

// validateRedirectUri already rejects these; this sends the user to guidance
// instead of the generic auth error page.
export function mcpBlockedClientPlugin(allowlist: RedirectAllowlist): BetterAuthPlugin {
  return {
    id: "mcp-blocked-client",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/oauth2/authorize",
          handler: createAuthMiddleware(async (ctx) => {
            const redirectUri: unknown = ctx.query?.redirect_uri;
            if (typeof redirectUri !== "string" || isAllowedRedirectUri(redirectUri, allowlist))
              return;
            throw ctx.redirect(
              `/mcp/blocked-client?${new URLSearchParams({ redirect_uri: redirectUri })}`,
            );
          }),
        },
      ],
    },
  };
}
