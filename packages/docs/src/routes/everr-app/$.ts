import { createFileRoute } from "@tanstack/react-router";
import { resolveDesktopReleaseRedirectUrl } from "@/lib/desktop-release-redirect";

export const Route = createFileRoute("/everr-app/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const redirectUrl = resolveDesktopReleaseRedirectUrl({
          pathname: new URL(request.url).pathname,
        });

        if (!redirectUrl) {
          return new Response("Not found", { status: 404 });
        }

        return Response.redirect(redirectUrl, 307);
      },
    },
  },
});
