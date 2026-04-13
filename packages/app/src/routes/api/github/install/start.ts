import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env";
import { auth } from "@/lib/auth.server";
import { createInstallState } from "@/lib/github-install-state";

export const Route = createFileRoute("/api/github/install/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({
          headers: request.headers,
        });
        if (!session?.user) {
          return new Response("unauthenticated", { status: 401 });
        }
        const activeOrgId = session.session.activeOrganizationId;
        if (!activeOrgId) {
          return new Response("missing active organization", {
            status: 400,
          });
        }

        const installURL = new URL(env.GITHUB_APP_INSTALL_URL);
        installURL.searchParams.set(
          "state",
          createInstallState({
            organizationId: activeOrgId,
            userId: session.user.id,
          }),
        );

        return Response.redirect(installURL.toString(), 302);
      },
    },
  },
});
