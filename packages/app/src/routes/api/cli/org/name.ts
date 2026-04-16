import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { auth } from "@/lib/auth.server";

const BodySchema = z.object({ name: z.string().min(1) });

export const Route = createFileRoute("/api/cli/org/name")({
  server: {
    handlers: {
      PATCH: async ({ request, context }) => {
        const parsed = BodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ error: "name is required" }, { status: 400 });
        }

        await auth.api.updateOrganization({
          headers: request.headers,
          body: {
            organizationId: context.session.session.activeOrganizationId,
            data: { name: parsed.data.name },
          },
        });

        return Response.json({ ok: true });
      },
    },
  },
});
