import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getWatchStatus } from "@/data/watch";
import { commitChannel } from "@/db/notify";
import { createSubscription } from "@/db/subscribe";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import { createSSEStream } from "@/lib/sse";

const WatchQuerySchema = z.object({
  repo: z.string().min(1),
  branch: z.string().min(1),
  commit: z.string().min(1),
});

export { WatchQuerySchema };

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

        const sse = createSSEStream(request);

        const initial = await getWatchStatus({
          tenantId: context.session.tenantId,
          ...parsed.data,
        });
        sse.sendEvent(initial);

        if (initial.state === "completed") {
          sse.close();
          return sse.response();
        }

        let throttled = false;
        let pendingFetch = false;

        function fetchAndSend() {
          throttled = true;
          getWatchStatus({
            tenantId: context.session.tenantId,
            ...parsed.data,
          })
            .then((status) => {
              sse.sendEvent(status);
              if (status.state === "completed") {
                cleanup();
                sse.close();
              }
            })
            .catch(() => {})
            .finally(() => {
              if (pendingFetch) {
                pendingFetch = false;
                fetchAndSend();
              } else {
                throttled = false;
              }
            });
        }

        const cleanup = createSubscription(
          [commitChannel(context.session.tenantId, parsed.data.commit)],
          () => {
            if (throttled) {
              pendingFetch = true;
            } else {
              fetchAndSend();
            }
          },
          () => {
            sse.sendEvent({ type: "error", message: "subscription lost" });
            sse.close();
          },
        );

        request.signal.addEventListener("abort", () => {
          cleanup();
        });

        return sse.response();
      },
    },
  },
});
