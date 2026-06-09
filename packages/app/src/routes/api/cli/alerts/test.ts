import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  parseAlertResourceFiles,
  renderAlertRuleQuery,
} from "@/data/alerts/schema";
import { querySqlApi } from "@/lib/clickhouse";

const requestSchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      content: z.string(),
    }),
  ),
});

const MAX_EVIDENCE_ROWS = 50;

export const Route = createFileRoute("/api/cli/alerts/test")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        try {
          const body = requestSchema.parse(await request.json());
          const parsed = parseAlertResourceFiles(body.files);
          const results = [];

          for (const rule of parsed.rules) {
            const query = renderAlertRuleQuery(rule.resource);
            const rows = await querySqlApi<Record<string, unknown>>(
              query,
              context.session.session.activeOrganizationId,
            );
            const evidence = rows.slice(0, MAX_EVIDENCE_ROWS);

            results.push({
              path: rule.path,
              project: rule.resource.metadata.project,
              name: rule.resource.metadata.name,
              severity: rule.resource.spec.severity,
              firing: rows.length > 0,
              rowCount: rows.length,
              truncated: rows.length > MAX_EVIDENCE_ROWS,
              evidence,
            });
          }

          return Response.json({ results });
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to test alert resources.",
            },
            { status: 400 },
          );
        }
      },
    },
  },
});
