import { createFileRoute } from "@tanstack/react-router";
import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@/lib/auth.server";

const handler = oauthProviderAuthServerMetadata(auth);

export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: { handlers: { GET: ({ request }) => handler(request) } },
});
