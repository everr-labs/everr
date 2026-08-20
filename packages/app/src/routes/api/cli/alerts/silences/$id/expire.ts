import { createFileRoute } from "@tanstack/react-router";
import { alertingMutationScope } from "@/data/alerting/session";
import { expireSilence } from "@/data/alerting/silences/repository";
import { alertingJson } from "../../-responses";

// Expire, not delete: alert history references the silence that withheld a
// notification, so the row outlives its window. See `expireSilence`.
export const Route = createFileRoute("/api/cli/alerts/silences/$id/expire")({
  server: {
    handlers: {
      POST: ({ params, context }) =>
        alertingJson(() =>
          expireSilence(alertingMutationScope(context.session), params.id),
        ),
    },
  },
});
