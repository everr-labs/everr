import { createFileRoute } from "@tanstack/react-router";
import { querySqlApi } from "@/lib/clickhouse";
import {
  boundEvidenceRows,
  parseAlertYaml,
  renderAlertQuery,
} from "@/server/alerts/parser";

type AlertsTestBody = {
  rawYaml?: unknown;
};

export const Route = createFileRoute("/api/cli/alerts/test")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const body = await readJsonBody<AlertsTestBody>(request);
        if (typeof body.rawYaml !== "string" || !body.rawYaml.trim()) {
          return Response.json(
            { error: "rawYaml is required." },
            { status: 400 },
          );
        }

        try {
          const parsed = parseAlertYaml(body.rawYaml);
          const alerts = [];

          for (const alert of parsed.alerts) {
            const rows = await querySqlApi<Record<string, unknown>>(
              renderAlertQuery(alert),
              context.session.session.activeOrganizationId,
            );
            const evidence = boundEvidenceRows(rows);

            alerts.push({
              service: alert.service,
              name: alert.name,
              severity: alert.severity,
              routing: alert.routing,
              firing: rows.length > 0,
              rowCount: rows.length,
              evidence: evidence.rows,
              truncated: evidence.truncated,
            });
          }

          return Response.json({
            filters: { target: "cloud" },
            alerts,
          });
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to test alerts.",
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
