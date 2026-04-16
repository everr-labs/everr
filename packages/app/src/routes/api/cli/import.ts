import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { githubInstallationOrganizations } from "@/db/schema";
import {
  backfillRepo,
  listInstallationRepos,
} from "@/server/github-events/backfill";

const BodySchema = z.object({ repos: z.array(z.string().min(1)).min(1) });

export const Route = createFileRoute("/api/cli/import")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const parsed = BodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json(
            { error: "repos must be a non-empty array" },
            { status: 400 },
          );
        }

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
        const activeInstallation = installations.find(
          (i) => i.status === "active",
        );
        if (!activeInstallation) {
          return Response.json(
            { error: "no active GitHub installation" },
            { status: 400 },
          );
        }

        const allRepos = await listInstallationRepos(
          activeInstallation.installationId,
        );
        const repos = parsed.data.repos
          .map((name) => allRepos.find((r) => r.full_name === name))
          .filter((r) => r != null);

        (async () => {
          for (const repo of repos) {
            try {
              for await (const _ of backfillRepo(
                activeInstallation.installationId,
                context.session.session.activeOrganizationId,
                repo,
              )) {
              }
            } catch {}
          }
        })().catch(() => {});

        return Response.json({ ok: true });
      },
    },
  },
});
