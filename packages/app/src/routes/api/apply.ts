import { createFileRoute } from "@tanstack/react-router";
import { requireOrgOrApiKeyMiddleware } from "@/data/as-code/apply-auth.server";
import { applyResources } from "@/data/as-code/registry";
import { applyInput } from "@/data/as-code/schema";

export const Route = createFileRoute("/api/apply")({
  server: {
    middleware: [requireOrgOrApiKeyMiddleware],
    handlers: {
      POST: async ({ request, context }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const parsed = applyInput.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.issues[0]?.message ?? "Invalid request" },
            { status: 400 },
          );
        }

        try {
          const summary = await applyResources({
            orgId: context.session.session.activeOrganizationId,
            source: parsed.data.source,
            documents: parsed.data.documents,
            dryRun: parsed.data.dryRun,
          });
          return Response.json(summary);
        } catch (error) {
          return Response.json(
            {
              error: error instanceof Error ? error.message : "Failed to apply",
            },
            { status: 400 },
          );
        }
      },
    },
  },
});
