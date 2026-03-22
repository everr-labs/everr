import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getWatchStatus } from "@/data/watch";
import { commitChannel } from "@/db/notify";
import { createSubscription } from "@/db/subscribe";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";

const WatchQuerySchema = z.object({
  repo: z.string().min(1),
  branch: z.string().min(1),
  commit: z.string().min(1),
});

export const Route = createFileRoute("/api/cli/runs/watch")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      GET: async ({ request, context }) => {
        const url = new URL(request.url);
        const parsed = WatchQuerySchema.safeParse({
          repo: url.searchParams.get("repo") ?? undefined,
          branch: url.searchParams.get("branch") ?? undefined,
          commit: url.searchParams.get("commit") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters for watch. Required: repo, branch, commit.",
            },
            { status: 400 },
          );
        }

        const { readable, writable } = new TransformStream<Uint8Array>();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        function sendEvent(data: object) {
          writer
            .write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
            .catch(() => {});
        }

        const initial = await getWatchStatus({
          tenantId: context.session.tenantId,
          ...parsed.data,
        });
        sendEvent(initial);

        if (initial.state === "completed") {
          writer.close().catch(() => {});
          return new Response(readable, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        }

        let cleanup: (() => void) | null = null;
        const heartbeatInterval = setInterval(() => {
          sendEvent({ type: "ping" });
        }, 30_000);

        cleanup = createSubscription(
          [commitChannel(context.session.tenantId, parsed.data.commit)],
          (_payload) => {
            getWatchStatus({
              tenantId: context.session.tenantId,
              ...parsed.data,
            })
              .then((status) => {
                sendEvent(status);
                if (status.state === "completed") {
                  clearInterval(heartbeatInterval);
                  cleanup?.();
                  writer.close().catch(() => {});
                }
              })
              .catch(() => {});
          },
          () => {
            clearInterval(heartbeatInterval);
            writer.close().catch(() => {});
          },
        );

        request.signal.addEventListener("abort", () => {
          clearInterval(heartbeatInterval);
          cleanup?.();
          writer.close().catch(() => {});
        });

        return new Response(readable, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
