import { createFileRoute } from "@tanstack/react-router";
import { replayHttpError, sessionJourney } from "#app/data/replay/session.ts";

export const Route = createFileRoute("/api/cli/recordings/sessions/$sessionId")({
  server: {
    handlers: {
      GET: async ({ params, request, context }) => {
        const url = new URL(request.url);
        try {
          const journey = await sessionJourney(context.organization.id, params.sessionId, {
            from: url.searchParams.get("from") ?? undefined,
            to: url.searchParams.get("to") ?? undefined,
          });
          return Response.json(journey);
        } catch (error) {
          return replayHttpError(error);
        }
      },
    },
  },
});
