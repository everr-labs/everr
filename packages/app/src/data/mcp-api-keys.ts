import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { getWorkOS } from "@/lib/workos";

export const createMcpApiKey = createServerFn({ method: "POST" }).handler(
  async () => {
    const requestId = crypto.randomUUID();
    const auth = await getAuth();

    if (!auth.user || !auth.organizationId) {
      throw new Error("You need an active organization to create an API key.");
    }

    const workos = getWorkOS();
    const name = `mcp-server-user-${auth.user.id}-${crypto.randomUUID().slice(0, 8)}`;

    try {
      const apiKey = await workos.organizations.createOrganizationApiKey({
        organizationId: auth.organizationId,
        name,
      });

      return {
        id: apiKey.id,
        name: apiKey.name,
        value: apiKey.value,
        obfuscatedValue: apiKey.obfuscatedValue,
        permissions: apiKey.permissions,
        organizationId: apiKey.owner.id,
        userId: auth.user.id,
        createdAt: apiKey.createdAt,
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
