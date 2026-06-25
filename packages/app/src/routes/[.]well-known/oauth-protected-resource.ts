import { createFileRoute } from "@tanstack/react-router";
import { MCP_RESOURCE } from "@/lib/mcp-resource";
import { mcpResourceClient } from "@/lib/mcp-resource-client";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: async () => {
        // PRM advertises ONLY observability:read - the helper throws on OIDC scopes.
        const meta = await mcpResourceClient().getProtectedResourceMetadata({
          resource: MCP_RESOURCE,
          scopes_supported: ["observability:read"],
        });
        return Response.json(meta, {
          headers: { "access-control-allow-origin": "*" },
        });
      },
    },
  },
});
