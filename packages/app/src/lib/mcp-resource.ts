import { env } from "@/env";

// Single source of truth for Better-Auth-derived URLs. Trimmed from
// BETTER_AUTH_URL — never the request origin (a 127.0.0.1-vs-localhost mismatch
// would fail closed).
export const AUTH_BASE = env.BETTER_AUTH_URL.replace(/\/$/, "");

// Better Auth is mounted at /api/auth, so the OAuth issuer (the JWT `iss` and
// what the AS discovery metadata advertises), the jwks_uri, and the
// continue/consent endpoints all live under this path.
export const AUTH_ISSUER = `${AUTH_BASE}/api/auth`;

// The MCP OAuth resource URI. Used by validAudiences (token issuance), the
// protected-resource-metadata doc, the WWW-Authenticate challenge, and
// verifyAccessToken.
export const MCP_RESOURCE = `${AUTH_BASE}/mcp`;
