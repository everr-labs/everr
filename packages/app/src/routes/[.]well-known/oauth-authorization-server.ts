import { createFileRoute } from "@tanstack/react-router";
import { oAuthDiscoveryMetadata } from "better-auth/plugins";
import { auth } from "@/lib/auth.server";

const handler = oAuthDiscoveryMetadata(auth);

export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: { handlers: { GET: ({ request }) => handler(request) } },
});
