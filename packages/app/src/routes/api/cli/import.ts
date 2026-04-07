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

        const encoder = new TextEncoder();
        const tenantId = context.session.tenantId;
        const installationId = active.installationId;

        const stream = new ReadableStream({
          async start(controller) {
            const emit = (obj: unknown) =>
              controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

            let totalJobs = 0;
            let totalErrors = 0;

            for (let i = 0; i < repos.length; i++) {
              const repo = repos[i];
              emit({
                type: "repo-start",
                repoFullName: repo.full_name,
                repoIndex: i,
                reposTotal: repos.length,
              });

              try {
                for await (const update of backfillRepo(
                  installationId,
                  tenantId,
                  repo,
                )) {
                  emit({
                    type: "progress",
                    progress: {
                      jobsEnqueued: update.jobsEnqueued,
                      jobsQuota: update.jobsQuota,
                      runsProcessed: update.runsProcessed,
                    },
                  });
                  if (update.status === "done") {
                    totalJobs += update.jobsEnqueued;
                    totalErrors += update.errors?.length ?? 0;
                  }
                }
              } catch {
                totalErrors++;
                emit({ type: "repo-error", repoFullName: repo.full_name });
              }
            }

            emit({ type: "done", totalJobs, totalErrors });
            controller.close();
          },
        });

        return new Response(stream, {
          headers: { "Content-Type": "application/x-ndjson" },
        });
      },
    },
  },
});
