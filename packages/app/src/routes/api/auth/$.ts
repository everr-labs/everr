import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth.server";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) =>
        redirectAuthErrorPage(request) ?? auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});

function redirectAuthErrorPage(request: Request) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/auth/error") {
    return null;
  }

  url.pathname = "/auth/error";
  return Response.redirect(url.toString());
}
