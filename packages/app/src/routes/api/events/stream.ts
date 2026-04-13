import { createFileRoute } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { z } from "zod";
import { subscribe, subscribeAuthor, subscribeTenant } from "@/db/hub";
import { auth } from "@/lib/auth.server";
import { createSSEStream } from "@/lib/sse";

const StreamQuerySchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("tenant") }),
  z.object({ scope: z.literal("trace"), key: z.string().min(1) }),
  z.object({ scope: z.literal("commit"), key: z.string().min(1) }),
  z.object({ scope: z.literal("author"), key: z.string().email() }),
]);

const authMiddleware = createMiddleware({ type: "request" }).server(
  async ({ next, request }) => {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.session || !session?.user) {
      return Response.json(
        { error: "You need to be authenticated to use this API" },
        { status: 401 },
      );
    }

    const activeOrgId = session.session.activeOrganizationId;
    if (!activeOrgId) {
      return Response.json(
        { error: "No active organization" },
        { status: 403 },
      );
    }

    return next({
      context: {
        session: {
          userId: session.user.id,
          organizationId: activeOrgId,
        },
      },
    });
  },
);

export const Route = createFileRoute("/api/events/stream")({
  server: {
    middleware: [authMiddleware],
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
              return subscribeTenant(session.organizationId, (payload) =>
                sse.sendEvent(payload),
              );
            case "trace":
              return subscribe(
                "trace",
                session.organizationId,
                parsed.data.key,
                (payload) => sse.sendEvent(payload),
              );
            case "commit":
              return subscribe(
                "commit",
                session.organizationId,
                parsed.data.key,
                (payload) => sse.sendEvent(payload),
              );
            case "author":
              return subscribeAuthor(
                session.organizationId,
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
