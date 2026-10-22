import { SpanStatusCode, trace } from "@opentelemetry/api";
import { createFileRoute } from "@tanstack/react-router";
import { createOrganizationSql } from "#app/lib/organization-sql.ts";
import { sanitizeSqlApiError } from "#app/lib/sql-api-error.ts";
import { classifySqlQueryError } from "#app/lib/sql-api-observability.ts";

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
        // The active span here is the SERVER span opened by the telemetry request middleware
        // (it wraps the whole fetch). We annotate it directly rather than open a
        // child, so SQL query health is queryable off the request span itself.
        const span = trace.getActiveSpan();
        const orgId = context.session.session.activeOrganizationId;

        span?.setAttribute("everr.feature", "sql_query");

        if (!sql.trim()) {
          span?.setAttribute("everr.sql_query.outcome", "user_error");
          span?.setAttribute("everr.sql_query.kind", "empty");
          return Response.json(
            { error: "SQL query is required." },
            { status: 400 },
          );
        }

        try {
          const storage = createOrganizationSql(
            orgId,
            context.organization.metadata,
          );
          const rows = await storage.query<Record<string, unknown>>(sql);

          span?.setAttribute("everr.sql_query.outcome", "ok");
          span?.setAttribute("everr.sql_query.result_rows", rows.length);

          return new Response(toNdjson(rows), {
            headers: {
              "content-type": "application/x-ndjson; charset=utf-8",
            },
          });
        } catch (error) {
          const { outcome, kind } = classifySqlQueryError(error);
          if (span) {
            span.setAttribute("everr.sql_query.outcome", outcome);
            span.setAttribute("everr.sql_query.kind", kind);
            // Only our-fault failures mark the span as an error, so error-rate
            // and the pager ignore user typos. User errors stay Ok-status.
            if (outcome === "system_error") {
              span.setStatus({ code: SpanStatusCode.ERROR, message: kind });
            }
          }
          return Response.json(
            { error: sanitizeSqlApiError(error) },
            kind === "account_setup"
              ? { status: 503, headers: { "Retry-After": "5" } }
              : { status: 400 },
          );
        }
      },
    },
  },
});
