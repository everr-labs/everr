import { getWorkOS } from "@/lib/workos";

const MCP_API_KEY_NAME_PREFIX = "mcp-server-user-";

export type ValidMcpApiKey = {
  id: string;
  organizationId: string;
  userId: string;
  name: string;
  permissions: string[];
};

export function getBearerToken(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token.trim();
}

export async function validateMcpApiKey(
  token: string,
): Promise<ValidMcpApiKey | null> {
  if (!token) {
    return null;
  }

  const workos = getWorkOS();
  const { apiKey } = await workos.apiKeys.validateApiKey({
    value: token,
  });

  if (!apiKey) {
    return null;
  }

  if (!apiKey.name.startsWith(MCP_API_KEY_NAME_PREFIX)) {
    return null;
  }

  const suffix = apiKey.name.slice(MCP_API_KEY_NAME_PREFIX.length);
  const lastDash = suffix.lastIndexOf("-");
  if (lastDash <= 0) {
    return null;
  }
  const userId = suffix.slice(0, lastDash);
  if (!userId) {
    return null;
  }

  return {
    id: apiKey.id,
    organizationId: apiKey.owner.id,
    userId,
    name: apiKey.name,
    permissions: apiKey.permissions,
  };
}
