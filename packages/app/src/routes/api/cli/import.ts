import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { githubInstallationOrganizations } from "@/db/schema";
import { auth } from "@/lib/auth.server";
import {
  backfillRepo,
  listInstallationRepos,
} from "@/server/github-events/backfill";

const BodySchema = z.object({ repos: z.array(z.string().min(1)).min(1) });
const IMPORT_MANAGER_ROLES = new Set(["admin", "owner"]);

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

        const { session, user } = context.session;
        const org = await auth.api.getFullOrganization({
          headers: request.headers,
          query: { organizationId: session.activeOrganizationId },
        });
        const currentMember = org?.members.find((m) => m.userId === user.id);
        if (!IMPORT_MANAGER_ROLES.has(currentMember?.role ?? "")) {
          return Response.json(
            { error: "only organization admins can import workflow history" },
            { status: 403 },
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
              session.activeOrganizationId,
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
                session.activeOrganizationId,
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
