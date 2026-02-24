import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { mcpTokens, tenants } from "@/db/schema";

export type ValidMcpApiKey = {
  tokenId: number;
  tenantId: number;
  organizationId: string;
  userId: string;
  name: string;
};

function hashMcpToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

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

  const tokenHash = hashMcpToken(token);
  const [storedToken] = await db
    .select({
      tokenId: mcpTokens.id,
      tenantId: tenants.id,
      organizationId: mcpTokens.organizationId,
      userId: mcpTokens.userId,
      name: mcpTokens.name,
    })
    .from(mcpTokens)
    .innerJoin(tenants, eq(tenants.externalId, mcpTokens.organizationId))
    .where(and(eq(mcpTokens.tokenHash, tokenHash), isNull(mcpTokens.revokedAt)))
    .limit(1);

  if (!storedToken) {
    return null;
  }

  return storedToken;
}
