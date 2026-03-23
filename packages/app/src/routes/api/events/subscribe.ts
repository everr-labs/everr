import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { tenantChannel, traceChannel } from "@/db/notify";
import { createSubscription } from "@/db/subscribe";
import {
  getAccessTokenSessionFromRequest,
  getWorkOSAuthSession,
} from "@/lib/auth";
import { createSSEStream } from "@/lib/sse";

const SubscribeQuerySchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("tenant") }),
  z.object({ scope: z.literal("trace"), traceId: z.string().min(1) }),
]);

export const Route = createFileRoute("/api/events/subscribe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let session = await getAccessTokenSessionFromRequest(request);
        if (!session) {
          session = await getWorkOSAuthSession();
        }
        if (!session) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(request.url);
        const parsed = SubscribeQuerySchema.safeParse({
          scope: url.searchParams.get("scope") ?? undefined,
          traceId: url.searchParams.get("traceId") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: scope (tenant|trace). For trace scope: traceId is also required.",
            },
            { status: 400 },
          );
        }

        const channel =
          parsed.data.scope === "tenant"
            ? tenantChannel(session.tenantId)
            : traceChannel(parsed.data.traceId);

        const sse = createSSEStream(request);

        const cleanup = createSubscription(
          channel,
          () => sse.sendEvent({ type: "update" }),
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
