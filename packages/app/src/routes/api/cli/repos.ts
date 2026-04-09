import { createFileRoute } from "@tanstack/react-router";
import { getGithubInstallationsForTenant } from "@/data/tenants";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import { listInstallationRepos } from "@/server/github-events/backfill";

export const Route = createFileRoute("/api/cli/repos")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      GET: async ({ context }) => {
        const installations = await getGithubInstallationsForTenant(
          context.session.tenantId,
        );
        const active = installations.find((i) => i.status === "active");

        if (!active) {
          return Response.json([]);
        }

        const repos = await listInstallationRepos(active.installationId);
        return Response.json(
          repos.map((r) => ({ id: r.id, fullName: r.full_name })),
        );
      },
    },
  },
});
