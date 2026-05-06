import { createFileRoute } from "@tanstack/react-router";
import { querySqlApi } from "@/lib/clickhouse";

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
          const rows = await querySqlApi<Record<string, unknown>>(
            sql,
            context.session.session.activeOrganizationId,
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
