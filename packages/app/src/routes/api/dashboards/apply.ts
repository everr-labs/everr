import { createFileRoute } from "@tanstack/react-router";
import { applyDashboardsInput } from "@/data/dashboards/schema";
import { applyDashboardSpecs } from "@/data/dashboards/server";
import { requireOrgOrApiKeyMiddleware } from "@/lib/serverFn";

export const Route = createFileRoute("/api/dashboards/apply")({
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

        const parsed = applyDashboardsInput.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.issues[0]?.message ?? "Invalid request" },
            { status: 400 },
          );
        }

        try {
          const summary = await applyDashboardSpecs({
            orgId: context.session.session.activeOrganizationId,
            source: parsed.data.source,
            documents: parsed.data.documents,
            dryRun: parsed.data.dryRun,
          });
          return Response.json(summary);
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to apply dashboards",
            },
            { status: 400 },
          );
        }
      },
    },
  },
});
