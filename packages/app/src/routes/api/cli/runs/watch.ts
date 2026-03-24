import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getWatchStatus } from "@/data/watch";
import { commitChannel } from "@/db/notify";
import { createSubscription } from "@/db/subscribe";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import { createSSEStream } from "@/lib/sse";
import { WatchMachine } from "./-watch-machine";

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

        const filters = parsed.data;
        const sse = createSSEStream(request);

        const initial = await getWatchStatus({
          tenantId: context.session.tenantId,
          ...filters,
        }).catch((error) => {
          sse.close();
          throw error;
        });

        sse.sendEvent(initial);

        if (initial.state === "completed") {
          sse.close();
          return sse.response();
        }

        const channel = commitChannel(context.session.tenantId, filters.commit);

        const machine = new WatchMachine({
          fetchStatus: () =>
            getWatchStatus({
              tenantId: context.session.tenantId,
              ...filters,
            }),
          sendEvent: (data) => sse.sendEvent(data),
          subscribe: (onNotify, onError) =>
            createSubscription(channel, onNotify, onError),
          close: () => sse.close(),
        });
        machine.start();

        request.signal.addEventListener("abort", () => machine.dispose());

        return sse.response();
      },
    },
  },
});
