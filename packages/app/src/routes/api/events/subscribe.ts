import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { tenantChannel, traceChannel } from "@/db/notify";
import { createSubscription } from "@/db/subscribe";
import {
  getAccessTokenSessionFromRequest,
  getWorkOSAuthSession,
} from "@/lib/auth";

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

        const { readable, writable } = new TransformStream<Uint8Array>();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        function sendEvent(data: object) {
          writer
            .write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
            .catch(() => {});
        }

        const cleanup = createSubscription(
          [channel],
          (payload) => sendEvent({ type: "update", ...payload }),
          () => writer.close().catch(() => {}),
        );

        const heartbeatInterval = setInterval(() => {
          sendEvent({ type: "ping" });
        }, 30_000);

        request.signal.addEventListener("abort", () => {
          clearInterval(heartbeatInterval);
          cleanup();
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
