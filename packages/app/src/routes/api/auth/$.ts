import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth.server";
import { runWithDeviceOrgCapture } from "@/lib/cli-device-organization";

// runWithDeviceOrgCapture opens the request-scoped store that carries the
// device-login org from the /device/token hook into session creation (see
// cli-device-organization.ts); it's a no-op for every other auth request.
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) =>
        redirectAuthErrorPage(request) ?? runWithDeviceOrgCapture(() => auth.handler(request)),
      POST: ({ request }) => runWithDeviceOrgCapture(() => auth.handler(request)),
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
