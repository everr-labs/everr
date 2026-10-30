import { env } from "#app/env/index.ts";

// Single source of truth for Better-Auth-derived URLs. Trimmed from
// BETTER_AUTH_URL — never the request origin (a 127.0.0.1-vs-localhost mismatch
// would fail closed).
export const AUTH_BASE = env.BETTER_AUTH_URL.replace(/\/$/, "");

// Better Auth is mounted at /api/auth, so the OAuth issuer (the JWT `iss` and
// what the AS discovery metadata advertises), the jwks_uri, and the
// continue/consent endpoints all live under this path.
export const AUTH_ISSUER = `${AUTH_BASE}/api/auth`;

// The MCP OAuth resource URI. Used by the configured resource policy for token
// issuance, the protected-resource metadata, the WWW-Authenticate challenge,
// and bearer-token verification.
export const mcpResourceForBaseURL = (baseURL: string) => `${baseURL.replace(/\/$/, "")}/mcp`;
export const MCP_RESOURCE = mcpResourceForBaseURL(AUTH_BASE);
