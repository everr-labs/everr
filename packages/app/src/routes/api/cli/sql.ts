import { createFileRoute } from "@tanstack/react-router";
import { queryWithClickHouseSettings } from "@/lib/clickhouse";

const CLOUD_SQL_LIMITS = {
  max_execution_time: 30,
  max_memory_usage: 200_000_000,
  max_result_bytes: 5_000_000,
  max_result_rows: 500,
  max_rows_to_read: 50_000,
  // Query-level SETTINGS do not need app-side parsing. ClickHouse docs say
  // readonly=1 permits only read queries and blocks changing settings, while
  // allow_ddl=0 explicitly denies DDL.
  // https://clickhouse.com/docs/operations/settings/permissions-for-queries#readonly
  allow_ddl: 0,
  readonly: 1,
} as const;

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

        if (!sql.trim()) {
          return Response.json(
            { error: "SQL query is required." },
            { status: 400 },
          );
        }

        try {
          const rows = await queryWithClickHouseSettings<
            Record<string, unknown>
          >(
            sql,
            context.session.session.activeOrganizationId,
            CLOUD_SQL_LIMITS,
          );

          return new Response(toNdjson(rows), {
            headers: {
              "content-type": "application/x-ndjson; charset=utf-8",
            },
          });
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to execute SQL query.",
            },
            { status: 400 },
          );
        }
      },
    },
  },
});
