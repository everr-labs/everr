import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import { workOS } from "@/lib/workos";

const BodySchema = z.object({ name: z.string().min(1) });

export const Route = createFileRoute("/api/cli/org/name")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      PATCH: async ({ request, context }) => {
        const parsed = BodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ error: "name is required" }, { status: 400 });
        }

        await workOS.organizations.updateOrganization({
          organization: context.session.organizationId,
          name: parsed.data.name,
        });

        return Response.json({ ok: true });
      },
    },
  },
});
