import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { accessTokens, tenants } from "@/db/schema";
import { getWorkOS } from "@/lib/workos";

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

async function hasOrganizationReadAccess(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  try {
    const workos = getWorkOS();
    const memberships = await workos.userManagement.listOrganizationMemberships(
      {
        userId,
        organizationId,
        statuses: ["active"],
        limit: 1,
      },
    );

    return memberships.data.length > 0;
  } catch (error) {
    console.error("[access-token-auth] org_access_check_failed", {
      userId,
      organizationId,
      error,
    });
    return false;
  }
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
      ),
    )
    .limit(1);

  if (!storedToken) {
    return null;
  }

  const hasReadAccess = await hasOrganizationReadAccess(
    storedToken.userId,
    storedToken.organizationId,
  );

  if (!hasReadAccess) {
    return null;
  }

  return storedToken;
}
