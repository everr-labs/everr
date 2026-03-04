import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { accessTokens, tenants } from "@/db/schema";

export type ValidAccessToken = {
  tokenId: number;
  tenantId: number;
  organizationId: string;
  userId: string;
  name: string;
};

function hashAccessToken(token: string): string {
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

export async function validateAccessToken(
  token: string,
): Promise<ValidAccessToken | null> {
  if (!token) {
    return null;
  }

  const tokenHash = hashAccessToken(token);
  const [storedToken] = await db
    .select({
      tokenId: accessTokens.id,
      tenantId: tenants.id,
      organizationId: accessTokens.organizationId,
      userId: accessTokens.userId,
      name: accessTokens.name,
    })
    .from(accessTokens)
    .innerJoin(tenants, eq(tenants.externalId, accessTokens.organizationId))
    .where(
      and(
        eq(accessTokens.tokenHash, tokenHash),
        isNull(accessTokens.revokedAt),
        gt(accessTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!storedToken) {
    return null;
  }

  return storedToken;
}
