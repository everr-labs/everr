import { createFileRoute } from "@tanstack/react-router";
import { pageAt, replayHttpError } from "#app/data/replay/session.ts";

export const Route = createFileRoute("/api/cli/recordings/sessions/$sessionId/page")({
  server: {
    handlers: {
      GET: async ({ params, request, context }) => {
        const url = new URL(request.url);
        try {
          const page = await pageAt(
            context.organization.id,
            {
              sessionId: params.sessionId,
              at: url.searchParams.get("at") ?? "",
              streamId: url.searchParams.get("streamId") ?? undefined,
              clipId: url.searchParams.get("clipId") ?? undefined,
            },
            { compact: url.searchParams.get("compact") === "1" },
          );
          return Response.json(page);
        } catch (error) {
          return replayHttpError(error);
        }
      },
    },
  },
});
