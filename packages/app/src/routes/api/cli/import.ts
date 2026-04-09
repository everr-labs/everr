import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getGithubInstallationsForTenant } from "@/data/tenants";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import {
  backfillRepo,
  listInstallationRepos,
} from "@/server/github-events/backfill";

const BodySchema = z.object({ repos: z.array(z.string().min(1)).min(1) });

export const Route = createFileRoute("/api/cli/import")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      POST: async ({ request, context }) => {
        const parsed = BodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json(
            { error: "repos must be a non-empty array" },
            { status: 400 },
          );
        }

        const installations = await getGithubInstallationsForTenant(
          context.session.tenantId,
        );
        const active = installations.find((i) => i.status === "active");
        if (!active) {
          return Response.json(
            { error: "no active GitHub installation" },
            { status: 400 },
          );
        }

        const allRepos = await listInstallationRepos(active.installationId);
        const repos = parsed.data.repos
          .map((name) => allRepos.find((r) => r.full_name === name))
          .filter((r) => r != null);

        const tenantId = context.session.tenantId;
        const installationId = active.installationId;

        (async () => {
          for (const repo of repos) {
            try {
              for await (const _ of backfillRepo(
                installationId,
                tenantId,
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
