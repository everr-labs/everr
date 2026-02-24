import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { db } from "@/db/client";
import { mcpTokens } from "@/db/schema";
import {
  generateMcpToken,
  getMcpTokenPrefix,
  hashMcpToken,
  obfuscateMcpTokenPrefix,
} from "@/lib/mcp-token";

export const createMcpApiKey = createServerFn({ method: "POST" }).handler(
  async () => {
    const requestId = crypto.randomUUID();
    const auth = await getAuth();

    if (!auth.user || !auth.organizationId) {
      throw new Error("You need an active organization to create an API key.");
    }

    const name = `mcp-server-${crypto.randomUUID().slice(0, 8)}`;
    const value = generateMcpToken();
    const tokenHash = hashMcpToken(value);
    const tokenPrefix = getMcpTokenPrefix(value);

    try {
      const [token] = await db
        .insert(mcpTokens)
        .values({
          organizationId: auth.organizationId,
          userId: auth.user.id,
          name,
          tokenHash,
          tokenPrefix,
        })
        .returning({
          id: mcpTokens.id,
          name: mcpTokens.name,
          tokenPrefix: mcpTokens.tokenPrefix,
          createdAt: mcpTokens.createdAt,
        });

      if (!token) {
        throw new Error("Token insert succeeded but no row was returned.");
      }

      return {
        id: token.id,
        name: token.name,
        value,
        tokenPrefix: token.tokenPrefix,
        obfuscatedValue: obfuscateMcpTokenPrefix(token.tokenPrefix),
        createdAt: token.createdAt,
      };
    } catch (error) {
      console.error("[mcp-api-keys] create_failed", {
        requestId,
        userId: auth.user.id,
        organizationId: auth.organizationId,
        name,
        error,
      });
      throw new Error(
        `We couldn't create your MCP API token right now. Please try again. (ref: ${requestId})`,
      );
    }
  },
);
