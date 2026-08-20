import { createFileRoute } from "@tanstack/react-router";
import {
  createChannel,
  listChannels,
} from "@/data/alerting/delivery/repository";
import { alertingMutationScope } from "@/data/alerting/session";
import { alertingJson, readJsonBody } from "./-responses";

// Auth + org context comes from the parent `/api/cli` route
// (requireOrgMiddleware); these are session-authenticated CLI endpoints.
export const Route = createFileRoute("/api/cli/alerts/channels")({
  server: {
    handlers: {
      // Secrets come back redacted, so a list never returns a usable webhook
      // URL or bot token.
      GET: ({ context }) =>
        alertingJson(() =>
          listChannels(context.session.session.activeOrganizationId),
        ),
      POST: ({ request, context }) =>
        alertingJson(async () =>
          createChannel(
            alertingMutationScope(context.session),
            await readJsonBody(request),
          ),
        ),
    },
  },
});
