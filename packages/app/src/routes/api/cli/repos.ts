import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { githubInstallationOrganizations } from "@/db/schema";
import { listInstallationRepos } from "@/server/github-events/backfill";

export const Route = createFileRoute("/api/cli/repos")({
  server: {
    handlers: {
      GET: async ({ context }) => {
        const installations = await db
          .select({
            installationId:
              githubInstallationOrganizations.githubInstallationId,
            status: githubInstallationOrganizations.status,
          })
          .from(githubInstallationOrganizations)
          .where(
            eq(
              githubInstallationOrganizations.organizationId,
              context.session.session.activeOrganizationId,
            ),
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
