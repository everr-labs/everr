import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";
import { AlertRuleYamlSchema } from "@/data/alerts/schema";
import {
  renderQuery,
  validateMessageTemplate,
  validateQueryTemplate,
  validateTopColumns,
} from "@/data/alerts/template";
import {
  type ParsedWindow,
  parseEvaluationInterval,
  parseWindow,
} from "@/data/alerts/window";
import { querySqlApiWithMeta, type SqlApiResult } from "@/lib/clickhouse";
import { boundEvidence } from "@/server/alerts/events";

const ResourceEntrySchema = z.object({
  path: z.string().min(1),
  resource: z.unknown(),
});

const OptionsSchema = z
  .object({
    local: z.boolean().optional(),
  })
  .passthrough()
  .default({});

const BodySchema = z.object({
  options: OptionsSchema,
  alerts: z.array(ResourceEntrySchema),
});

function firstIssueMessage(error: {
  issues: readonly { message: string }[];
}): string {
  return error.issues[0]?.message ?? "invalid alert rule";
}

function badRequest(path: string, message: string): Response {
  return Response.json({ error: `${path}: ${message}` }, { status: 400 });
}

export const Route = createFileRoute("/api/cli/alerts/test")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const parsedBody = BodySchema.safeParse(raw);
        if (!parsedBody.success) {
          return Response.json(
            {
              error:
                parsedBody.error.issues[0]?.message ?? "Invalid request body",
            },
            { status: 400 },
          );
        }

        const organizationId = context?.session?.session?.activeOrganizationId;
        if (!organizationId) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const results = [];

        for (const { path, resource } of parsedBody.data.alerts) {
          const parsedRule = AlertRuleYamlSchema.safeParse(resource);
          if (!parsedRule.success) {
            return badRequest(
              path,
              `invalid alert rule: ${firstIssueMessage(parsedRule.error)}`,
            );
          }

          const rule = parsedRule.data;
          let window: ParsedWindow;
          try {
            parseEvaluationInterval(rule.spec.evaluationInterval);
            window = parseWindow(rule.spec.window);
            validateQueryTemplate(rule.spec.query);
            validateMessageTemplate(rule.spec.summary);
            if (rule.spec.description) {
              validateMessageTemplate(rule.spec.description);
            }
          } catch (error) {
            return badRequest(
              path,
              error instanceof Error ? error.message : String(error),
            );
          }

          const query = renderQuery(rule.spec.query, window.interval);
          let queryResult: SqlApiResult<Record<string, unknown>>;
          try {
            queryResult = await querySqlApiWithMeta<Record<string, unknown>>(
              query,
              organizationId,
            );
          } catch (error) {
            return badRequest(
              path,
              `query failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }

          try {
            validateTopColumns(rule.spec.summary, queryResult.columns);
            if (rule.spec.description) {
              validateTopColumns(rule.spec.description, queryResult.columns);
            }
          } catch (error) {
            return badRequest(
              path,
              error instanceof Error ? error.message : String(error),
            );
          }

          const evidence = boundEvidence(queryResult.rows);
          results.push({
            path,
            slug: rule.metadata.name,
            firing: evidence.rowCount > 0,
            rowCount: evidence.rowCount,
            columns: queryResult.columns,
            evidence: evidence.rows,
            truncated: evidence.truncated,
          });
        }

        return Response.json({
          options: parsedBody.data.options,
          results,
        });
      },
    },
  },
});
