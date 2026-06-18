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

        let repos: Awaited<ReturnType<typeof listInstallationRepos>>;
        try {
          repos = await listInstallationRepos(active.installationId);
        } catch (error) {
          if (isMissingGitHubInstallation(error)) {
            return Response.json([]);
          }
          throw error;
        }

        return Response.json(
          repos.map((r) => ({ id: r.id, fullName: r.full_name })),
        );
      },
    },
  },
});

function isMissingGitHubInstallation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message;
  return (
    message.startsWith("Failed to create installation token: status=404") ||
    (message.startsWith(
      "GitHub API error: GET https://api.github.com/installation/repositories",
    ) &&
      message.includes(" status=404 "))
  );
}
