import { createFileRoute } from "@tanstack/react-router";
import { protectedResourceMetadataResponse } from "#app/lib/mcp-resource-client.ts";

// The MCP auth challenge pointed here before the RFC 9728 path
// (/.well-known/oauth-protected-resource/mcp), and the MCP spec still lists it
// as the fallback for clients without the challenge: keep it.
export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: { handlers: { GET: () => protectedResourceMetadataResponse() } },
});
