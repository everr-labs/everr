import { createFileRoute } from "@tanstack/react-router";
import { auth } from "#app/identity/server.ts";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => redirectAuthErrorPage(request) ?? auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});

function redirectAuthErrorPage(request: Request) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/auth/error") {
    return null;
  }

  // Relative, like every redirect built from the request: see install-callback.ts
  return new Response(null, {
    status: 302,
    headers: { Location: `/auth/error${url.search}` },
  });
}
