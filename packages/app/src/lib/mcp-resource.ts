import { env } from "@/env";

// Single source of truth for the MCP OAuth resource URI. Used by validAudiences
// (token issuance), the protected-resource-metadata doc, the WWW-Authenticate
// challenge, and verifyAccessToken. Derived from BETTER_AUTH_URL — never the
// request origin (origin mismatch like 127.0.0.1 vs localhost would fail closed).
export const MCP_RESOURCE = `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/mcp`;
