import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@workos/authkit-tanstack-react-start";

import { env } from "@/env";
import { createInstallState } from "@/lib/github-install-state";

export const Route = createFileRoute("/api/github/install/start")({
  server: {
    handlers: {
      GET: async () => {
        const auth = await getAuth();
        if (!auth.user) {
          return new Response("unauthenticated", { status: 401 });
        }
        if (!auth.organizationId) {
          return new Response("missing active organization", {
            status: 400,
          });
        }

        const installURL = new URL(env.GITHUB_APP_INSTALL_URL);
        installURL.searchParams.set(
          "state",
          createInstallState({
            organizationId: auth.organizationId,
            userId: auth.user.id,
          }),
        );

        return Response.redirect(installURL.toString(), 302);
      },
    },
  },
});
