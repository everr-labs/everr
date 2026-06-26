import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth.server";

// better-auth's issuer is "<host>/api/auth", so per RFC 8414 the authorization
// server metadata must be served at the path-suffixed well-known location
// "/.well-known/oauth-authorization-server/api/auth" (the unsuffixed sibling
// route covers issuer "<host>"). Same handler, just the spec-required path.
const handler = oauthProviderAuthServerMetadata(auth);

export const Route = createFileRoute(
  "/.well-known/oauth-authorization-server/api/auth",
)({
  server: { handlers: { GET: ({ request }) => handler(request) } },
});
