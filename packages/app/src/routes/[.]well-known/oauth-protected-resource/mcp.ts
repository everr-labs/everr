import { createFileRoute } from "@tanstack/react-router";
import { protectedResourceMetadataResponse } from "#app/lib/mcp-resource-client.ts";

// RFC 9728 section 3.1: the metadata of the resource <host>/mcp lives at
// /.well-known/oauth-protected-resource/mcp, the URL the MCP auth challenge
// points to. The unsuffixed sibling answers the same document.
export const Route = createFileRoute("/.well-known/oauth-protected-resource/mcp")({
  server: { handlers: { GET: () => protectedResourceMetadataResponse() } },
});
