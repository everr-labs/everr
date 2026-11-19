import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { subscribeTenant, subscribeTrace } from "#app/db/hub.ts";
import { requireOrgRequestMiddleware } from "#app/lib/org-request-middleware.server.ts";
import { createSSEStream } from "#app/lib/sse.ts";

const StreamQuerySchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("tenant") }),
  z.object({ scope: z.literal("trace"), key: z.string().min(1) }),
]);

export const Route = createFileRoute("/api/events/stream")({
  server: {
    middleware: [requireOrgRequestMiddleware],
    handlers: {
      GET: async ({ request, context }) => {
        const organizationId = context.organization.id;
        const url = new URL(request.url);
        const parsed = StreamQuerySchema.safeParse({
          scope: url.searchParams.get("scope") ?? undefined,
          key: url.searchParams.get("key") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: scope (tenant|trace). For scope=trace, key is also required.",
            },
            { status: 400 },
          );
        }

        const sse = createSSEStream(request);

        const unsubscribe = (() => {
          switch (parsed.data.scope) {
            case "tenant":
              return subscribeTenant(organizationId, (payload) => sse.sendEvent(payload));
            case "trace":
              return subscribeTrace(organizationId, parsed.data.key, (payload) =>
                sse.sendEvent(payload),
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
