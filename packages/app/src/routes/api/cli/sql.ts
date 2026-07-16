import { SpanStatusCode, trace } from "@opentelemetry/api";
import { createFileRoute } from "@tanstack/react-router";
import { querySqlApi } from "@/lib/clickhouse";
import { sanitizeSqlApiError } from "@/lib/sql-api-error";
import {
  classifyCloudQueryError,
  extractQueryShape,
} from "@/lib/sql-api-observability";

function toNdjson(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "";
  }

  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

export const Route = createFileRoute("/api/cli/sql")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const sql = await request.text();
        // The active span here is the SERVER span opened by instrumentServerFetch
        // (it wraps the whole fetch). We annotate it directly rather than open a
        // child, so cloud-query health is queryable off the request span itself.
        const span = trace.getActiveSpan();
        const orgId = context.session.session.activeOrganizationId;

        if (span) {
          span.setAttribute("everr.feature", "cloud_query");
          if (orgId) {
            span.setAttribute("everr.org_id", orgId);
          }
          // Safe structured facts only — never the query text or any literal.
          const shape = extractQueryShape(sql);
          if (shape.tables.length > 0) {
            span.setAttribute(
              "everr.cloud_query.tables",
              shape.tables.join(","),
            );
          }
          if (shape.attrKeys.length > 0) {
            span.setAttribute(
              "everr.cloud_query.attr_keys",
              shape.attrKeys.join(","),
            );
          }
        }

        if (!sql.trim()) {
          span?.setAttribute("everr.cloud_query.outcome", "user_error");
          span?.setAttribute("everr.cloud_query.kind", "empty");
          return Response.json(
            { error: "SQL query is required." },
            { status: 400 },
          );
        }

        try {
          const rows = await querySqlApi<Record<string, unknown>>(sql, orgId);

          span?.setAttribute("everr.cloud_query.outcome", "ok");
          span?.setAttribute("everr.cloud_query.result_rows", rows.length);

          return new Response(toNdjson(rows), {
            headers: {
              "content-type": "application/x-ndjson; charset=utf-8",
            },
          });
        } catch (error) {
          const { outcome, kind } = classifyCloudQueryError(error);
          if (span) {
            span.setAttribute("everr.cloud_query.outcome", outcome);
            span.setAttribute("everr.cloud_query.kind", kind);
            // Only our-fault failures mark the span as an error, so error-rate
            // and the pager ignore user typos. User errors stay Ok-status.
            if (outcome === "system_error") {
              span.setStatus({ code: SpanStatusCode.ERROR, message: kind });
            }
          }
          return Response.json(
            { error: sanitizeSqlApiError(error) },
            { status: 400 },
          );
        }
      },
    },
  },
});
