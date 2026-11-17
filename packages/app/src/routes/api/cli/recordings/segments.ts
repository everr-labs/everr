import { createFileRoute } from "@tanstack/react-router";
import {
  parseSegmentsRequest,
  readSegments,
  replayHttpError,
  segmentsBody,
} from "#app/data/replay/index.ts";

/**
 * `everr cloud recording show`: the Segments of the page of a recorded visit
 * just after a moment, as JSON lines, gzipped when the client accepts it. The
 * CLI rebuilds the page. Params are the CLI flag names.
 */
export const Route = createFileRoute("/api/cli/recordings/segments")({
  server: {
    handlers: {
      GET: async ({ request, context }) => {
        try {
          const params = new URL(request.url).searchParams;
          const read = await readSegments(
            context.session.session.activeOrganizationId,
            parseSegmentsRequest(params),
          );
          const body = segmentsBody(read);
          const gzip = /\bgzip\b/.test(request.headers.get("accept-encoding") ?? "");
          return new Response(gzip ? body.pipeThrough(new CompressionStream("gzip")) : body, {
            headers: {
              "content-type": "application/x-ndjson",
              "cache-control": "no-store",
              vary: "accept-encoding",
              ...(gzip ? { "content-encoding": "gzip" } : {}),
            },
          });
        } catch (error) {
          return replayHttpError(error);
        }
      },
    },
  },
});
