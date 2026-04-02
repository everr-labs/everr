import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { subscribe, subscribeAuthor, subscribeTenant } from "@/db/hub";
import { anyAuthMiddleware } from "@/lib/anyAuthMiddleware";
import { createSSEStream } from "@/lib/sse";

const StreamQuerySchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("tenant") }),
  z.object({ scope: z.literal("trace"), key: z.string().min(1) }),
  z.object({ scope: z.literal("commit"), key: z.string().min(1) }),
  z.object({ scope: z.literal("author"), key: z.string().email() }),
]);

export const Route = createFileRoute("/api/events/stream")({
  server: {
    middleware: [anyAuthMiddleware],
    handlers: {
      GET: async ({ request, context }) => {
        const { session } = context;

        const url = new URL(request.url);
        const parsed = StreamQuerySchema.safeParse({
          scope: url.searchParams.get("scope") ?? undefined,
          key: url.searchParams.get("key") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: scope (tenant|trace|commit|author). For non-tenant scopes: key is also required.",
            },
            { status: 400 },
          );
        }

        const sse = createSSEStream(request);

        const unsubscribe = (() => {
          switch (parsed.data.scope) {
            case "tenant":
              return subscribeTenant(session.tenantId, (payload) =>
                sse.sendEvent(payload),
              );
            case "trace":
              return subscribe(
                "trace",
                session.tenantId,
                parsed.data.key,
                (payload) => sse.sendEvent(payload),
              );
            case "commit":
              return subscribe(
                "commit",
                session.tenantId,
                parsed.data.key,
                (payload) => sse.sendEvent(payload),
              );
            case "author":
              return subscribeAuthor(
                session.tenantId,
                parsed.data.key,
                (payload) => sse.sendEvent(payload),
              );
          }
        })();

        request.signal.addEventListener("abort", () => {
          unsubscribe();
        });

        return sse.response();
      },
    },
  },
});
