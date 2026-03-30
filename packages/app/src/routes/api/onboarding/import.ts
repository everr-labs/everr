import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getGithubInstallationsForTenant } from "@/data/tenants";
import { sessionAuthMiddleware } from "@/lib/sessionAuthMiddleware";
import {
  backfillRepo,
  listInstallationRepos,
} from "@/server/github-events/backfill";

const ImportBodySchema = z.object({
  repoFullName: z.string().min(1),
});

export const Route = createFileRoute("/api/onboarding/import")({
  server: {
    middleware: [sessionAuthMiddleware],
    handlers: {
      POST: async ({ request, context }) => {
        const body = await request.json();
        const parsed = ImportBodySchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "Invalid request body. Required: repoFullName" },
            { status: 400 },
          );
        }

        const installations = await getGithubInstallationsForTenant(
          context.session.tenantId,
        );
        const active = installations.find((i) => i.status === "active");
        if (!active) {
          return Response.json(
            { error: "No active GitHub installation found" },
            { status: 400 },
          );
        }

        const allRepos = await listInstallationRepos(active.installationId);
        const repo = allRepos.find(
          (r) => r.full_name === parsed.data.repoFullName,
        );
        if (!repo) {
          return Response.json(
            { error: "Repository is not accessible" },
            { status: 404 },
          );
        }

        const { readable, writable } = new TransformStream<Uint8Array>();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        const writeJson = (data: object) =>
          writer.write(encoder.encode(JSON.stringify(data) + "\n"));

        // Run backfill in background, stream progress
        backfillRepo(
          active.installationId,
          context.session.tenantId,
          repo,
          (update) => {
            writeJson(update).catch(() => {});
          },
        )
          .then(() => {
            writer.close().catch(() => {});
          })
          .catch(async (err) => {
            const msg = err instanceof Error ? err.message : String(err);
            await writeJson({ status: "error", error: msg }).catch(() => {});
            writer.close().catch(() => {});
          });

        return new Response(readable, {
          headers: {
            "Content-Type": "application/x-ndjson",
            "Cache-Control": "no-cache",
          },
        });
      },
    },
  },
});
