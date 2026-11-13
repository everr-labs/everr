import { createFileRoute } from "@tanstack/react-router";
import { protectedResourceMetadataResponse } from "#app/lib/mcp-resource-client.ts";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: { handlers: { GET: () => protectedResourceMetadataResponse() } },
});
