import { createFileRoute } from "@tanstack/react-router";
import { querySqlApi } from "@/lib/clickhouse";
import { parseAlertYaml, renderAlertQuery } from "@/server/alerts/parser";
import { upsertAlertDefinitions } from "@/server/alerts/repository";
import { routingListExists } from "@/server/alerts/routing";

type AlertsUploadBody = {
  rawYaml?: unknown;
  sourceUrl?: unknown;
  git?: {
    repo?: unknown;
    branch?: unknown;
    commitSha?: unknown;
    remote?: unknown;
    path?: unknown;
  };
};

export const Route = createFileRoute("/api/cli/alerts/upload")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const body = await readJsonBody<AlertsUploadBody>(request);
        if (typeof body.rawYaml !== "string" || !body.rawYaml.trim()) {
          return Response.json(
            { error: "rawYaml is required." },
            { status: 400 },
          );
        }
        if (typeof body.sourceUrl !== "string" || !body.sourceUrl.trim()) {
          return Response.json(
            { error: "sourceUrl is required." },
            { status: 400 },
          );
        }

        const organizationId = context.session.session.activeOrganizationId;
        const userId =
          context.session.user?.id ?? context.session.session.userId;

        try {
          const parsed = parseAlertYaml(body.rawYaml);

          for (const alert of parsed.alerts) {
            const exists = await routingListExists({
              organizationId,
              slug: alert.routing,
            });
            if (!exists) {
              return Response.json(
                { error: `Unknown routing list "${alert.routing}".` },
                { status: 400 },
              );
            }
          }

          for (const alert of parsed.alerts) {
            await querySqlApi<Record<string, unknown>>(
              renderAlertQuery(alert),
              organizationId,
            );
          }

          const result = await upsertAlertDefinitions({
            organizationId,
            rawYaml: body.rawYaml,
            sourceUrl: body.sourceUrl,
            sourceRepo: optionalString(body.git?.repo),
            sourceBranch: optionalString(body.git?.branch),
            sourceCommitSha: optionalString(body.git?.commitSha),
            sourceRemote: optionalString(body.git?.remote),
            sourcePath: optionalString(body.git?.path),
            userId,
            alerts: parsed.alerts.map((alert) => ({
              service: alert.service,
              name: alert.name,
              severity: alert.severity,
              routing: alert.routing,
              evaluationIntervalSeconds: alert.evaluationIntervalSeconds,
              windowSeconds: alert.windowSeconds,
              query: alert.query,
              summary: alert.summary,
              description: alert.description,
            })),
          });

          return Response.json({
            uploaded: result.uploaded,
            deactivated: result.deactivated,
            sourceUrl: body.sourceUrl,
          });
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to upload alerts.",
            },
            { status: 400 },
          );
        }
      },
    },
  },
});

async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
