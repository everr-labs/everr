import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { subscribeAuthor } from "@/db/hub";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import { createSSEStream } from "@/lib/sse";
import { getFailureNotifications } from "@/routes/api/cli/-failure-notifications";
import { FailureStreamMachine } from "./-stream-machine";

const StreamQuerySchema = z.object({
  gitEmail: z.string().email(),
});

export const Route = createFileRoute("/api/cli/notifier/failures/stream")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      GET: async ({ request, context }) => {
        const url = new URL(request.url);
        const parsed = StreamQuerySchema.safeParse({
          gitEmail: url.searchParams.get("gitEmail") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            { error: "Invalid query parameters. Required: gitEmail." },
            { status: 400 },
          );
        }

        const { gitEmail } = parsed.data;
        const sse = createSSEStream(request);

        const fetchFailures = () =>
          getFailureNotifications({
            context,
            gitEmail,
            origin: url.origin,
            timeWindowMinutes: 5,
          });

        const machine = new FailureStreamMachine({
          fetchFailures,
          sendEvent: (data) => sse.sendEvent(data),
          subscribe: (onNotify) =>
            subscribeAuthor(context.session.tenantId, gitEmail, onNotify),
        });

        await machine.sendBackfill().catch((error) => {
          machine.dispose();
          throw error;
        });

        machine.start();

        request.signal.addEventListener("abort", () => {
          machine.dispose();
          sse.close();
        });

        return sse.response();
      },
    },
  },
});
