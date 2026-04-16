import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getFailureNotifications } from "@/data/notifications";

const NotificationQuerySchema = z.object({
  traceId: z.string().min(1),
});

export const Route = createFileRoute("/api/cli/notification")({
  server: {
    handlers: {
      GET: async ({ request, context }) => {
        const url = new URL(request.url);
        const parsed = NotificationQuerySchema.safeParse({
          traceId: url.searchParams.get("traceId") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            { error: "Invalid query parameters. Required: traceId." },
            { status: 400 },
          );
        }

        const failures = await getFailureNotifications({
          tenantId: context.session.session.activeOrganizationId,
          origin: url.origin,
          traceId: parsed.data.traceId,
        });

        return Response.json(failures);
      },
    },
  },
});
