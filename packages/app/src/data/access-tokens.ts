import { getAuth } from "@workos/authkit-tanstack-react-start";
import { db } from "@/db/client";
import { accessTokens } from "@/db/schema";
import {
  generateAccessToken,
  getAccessTokenPrefix,
  hashAccessToken,
  obfuscateAccessTokenPrefix,
} from "@/lib/access-token";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

export const createAccessToken = createAuthenticatedServerFn({
  method: "POST",
}).handler(async () => {
  const requestId = crypto.randomUUID();
  const auth = await getAuth();

  if (!auth.user || !auth.organizationId) {
    throw new Error("You need an active organization to create a token.");
  }

  const name = `access-token-${crypto.randomUUID().slice(0, 8)}`;
  const value = generateAccessToken();
  const tokenHash = hashAccessToken(value);
  const tokenPrefix = getAccessTokenPrefix(value);

  try {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const [token] = await db
      .insert(accessTokens)
      .values({
        organizationId: auth.organizationId,
        userId: auth.user.id,
        name,
        tokenHash,
        tokenPrefix,
        expiresAt,
      })
      .returning({
        id: accessTokens.id,
        name: accessTokens.name,
        tokenPrefix: accessTokens.tokenPrefix,
        createdAt: accessTokens.createdAt,
      });

    if (!token) {
      throw new Error("Token insert succeeded but no row was returned.");
    }

    return {
      id: token.id,
      name: token.name,
      value,
      tokenPrefix: token.tokenPrefix,
      obfuscatedValue: obfuscateAccessTokenPrefix(token.tokenPrefix),
      createdAt: token.createdAt,
    };
  } catch (error) {
    console.error("[access-tokens] create_failed", {
      requestId,
      userId: auth.user.id,
      organizationId: auth.organizationId,
      name,
      error,
    });
    throw new Error(
      `We couldn't create your token right now. Please try again. (ref: ${requestId})`,
    );
  }
});
