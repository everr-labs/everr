import { createFileRoute } from "@tanstack/react-router";

import { unlinkGithubInstallation } from "@/data/tenants";

type InstallationEventPayload = {
  action?: string;
  installation?: {
    id?: number;
  };
};

export const Route = createFileRoute("/api/github/install-events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const eventType = request.headers.get("x-github-event") ?? "";
        if (
          eventType !== "installation" &&
          eventType !== "installation_repositories"
        ) {
          return new Response("ignored", { status: 202 });
        }

        let payload: InstallationEventPayload;
        try {
          payload = (await request.json()) as InstallationEventPayload;
        } catch {
          return new Response("invalid json payload", { status: 400 });
        }

        const installationId = payload.installation?.id;
        if (!installationId) {
          return new Response("missing installation.id", { status: 400 });
        }

        // Installation lifecycle events that indicate the mapping should be removed.
        if (
          eventType === "installation" &&
          (payload.action === "deleted" || payload.action === "suspend")
        ) {
          await unlinkGithubInstallation(installationId);
        }

        return new Response(null, { status: 202 });
      },
    },
  },
});
