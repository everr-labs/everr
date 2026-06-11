import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";
import {
  AlertRuleValidationError,
  parseAlertRule,
  validateAlertRuleQuery,
} from "@/data/alerts/validate.server";
import { resourceEntrySchema } from "@/data/as-code/schema";
import { boundEvidence } from "@/server/alerts/events";

const OptionsSchema = z
  .object({
    local: z.boolean().optional(),
  })
  .passthrough()
  .default({});

const BodySchema = z.object({
  options: OptionsSchema,
  alerts: z.array(resourceEntrySchema),
});

function badRequest(error: unknown): Response {
  if (error instanceof AlertRuleValidationError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  throw error;
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

        // Same pipeline as `everr apply` (see data/alerts/validate.server.ts):
        // static validation first, then the independent validation queries
        // concurrently, reporting failures in file order.
        let parsedRules: {
          path: string;
          rule: ReturnType<typeof parseAlertRule>;
        }[];
        try {
          parsedRules = parsedBody.data.alerts.map(({ path, resource }) => ({
            path,
            rule: parseAlertRule(path, resource),
          }));
        } catch (error) {
          return badRequest(error);
        }

        const validations = await Promise.allSettled(
          parsedRules.map(({ path, rule }) =>
            validateAlertRuleQuery(path, rule.rule, organizationId),
          ),
        );

        const results = [];
        for (const [index, { path, rule }] of parsedRules.entries()) {
          const validation = validations[index];
          if (validation.status === "rejected") {
            return badRequest(validation.reason);
          }

          const evidence = boundEvidence(validation.value.queryResult.rows);
          results.push({
            path,
            slug: rule.slug,
            firing: evidence.rowCount > 0,
            rowCount: evidence.rowCount,
            columns: validation.value.queryResult.columns,
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
