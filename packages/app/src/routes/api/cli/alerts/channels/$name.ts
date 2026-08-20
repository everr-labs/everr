import { createFileRoute } from "@tanstack/react-router";
import {
  deleteChannel,
  updateChannel,
} from "@/data/alerting/delivery/repository";
import { alertingMutationScope } from "@/data/alerting/session";
import { alertingJson, readJsonBody } from "../-responses";

// Channels are addressed by name: it is what a rule's `notifications.channels`
// names and what delivery resolves at flush, so the id never leaves the server.
export const Route = createFileRoute("/api/cli/alerts/channels/$name")({
  server: {
    handlers: {
      // A config whose secret arrives as "***" keeps the stored one, so an edit
      // that only renames never re-sends the secret in clear.
      PATCH: ({ params, request, context }) =>
        alertingJson(async () =>
          updateChannel(
            alertingMutationScope(context.session),
            params.name,
            await readJsonBody(request),
          ),
        ),
      DELETE: ({ params, context }) =>
        alertingJson(() =>
          deleteChannel(alertingMutationScope(context.session), params.name),
        ),
    },
  },
});
