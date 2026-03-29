import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { subscribe } from "@/db/hub";
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

        const sse = createSSEStream(request);

        const [topic, key] =
          parsed.data.scope === "tenant"
            ? (["tenant", String(session.tenantId)] as const)
            : ([
                "trace",
                `${session.tenantId}:${parsed.data.traceId}`,
              ] as const);

        const unsubscribe = subscribe(topic, key, () =>
          sse.sendEvent({ type: "update" }),
        );

        request.signal.addEventListener("abort", () => {
          unsubscribe();
        });

        return sse.response();
      },
    },
  },
});
