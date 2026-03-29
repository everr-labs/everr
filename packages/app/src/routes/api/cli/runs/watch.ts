import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getWatchStatus } from "@/data/watch";
import { subscribe } from "@/db/hub";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import { createSSEStream } from "@/lib/sse";
import { WatchMachine } from "./-watch-machine";

const WatchQuerySchema = z.object({
  repo: z.string().min(1),
  branch: z.string().min(1).optional(),
  commit: z.string().min(1),
  attempt: z.coerce.number().int().min(1).optional(),
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
          attempt: url.searchParams.get("attempt") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters for watch. Required: repo, commit. Optional: branch.",
            },
            { status: 400 },
          );
        }

        const filters = parsed.data;
        const sse = createSSEStream(request);
        const fetchStatus = () =>
          getWatchStatus({
            tenantId: context.session.tenantId,
            ...filters,
          });

        const machine = new WatchMachine({
          fetchStatus,
          sendEvent: (data) => sse.sendEvent(data),
          subscribe: (onNotify) =>
            subscribe(
              "commit",
              context.session.tenantId,
              filters.commit,
              onNotify,
            ),
          close: () => sse.close(),
        });
        machine.start();

        const initial = await fetchStatus().catch((error) => {
          machine.dispose();
          throw error;
        });

        sse.sendEvent(initial);

        if (initial.state === "completed") {
          machine.dispose();
          return sse.response();
        }

        request.signal.addEventListener("abort", () => machine.dispose());

        return sse.response();
      },
    },
  },
});
