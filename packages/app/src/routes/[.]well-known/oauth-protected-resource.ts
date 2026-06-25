import { createFileRoute } from "@tanstack/react-router";
import { MCP_RESOURCE } from "@/lib/mcp-resource";
import { mcpResourceClient } from "@/lib/mcp-resource-client";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: async () => {
        // Advertise observability:read (the resource scope) plus offline_access
        // so DCR clients (e.g. Claude Code) register for a refresh token; without
        // it, the client registers narrowly and the authorize step rejects its
        // offline_access request. The helper only forbids `openid` here.
        const meta = await mcpResourceClient().getProtectedResourceMetadata({
          resource: MCP_RESOURCE,
          scopes_supported: ["observability:read", "offline_access"],
        });
        return Response.json(meta, {
          headers: { "access-control-allow-origin": "*" },
        });
      },
    },
  },
});
