import { createFileRoute } from "@tanstack/react-router";
import { queryWithClickHouseSettings } from "@/lib/clickhouse";

const CLOUD_SQL_LIMITS = {
  max_memory_usage: 200_000_000,
  max_result_bytes: 5_000_000,
  max_result_rows: 500,
  max_rows_to_read: 50_000,
} as const;

function toNdjson(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "";
  }

  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function isSqlWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char);
}

function skipQuoted(
  sql: string,
  start: number,
  quote: "'" | '"' | "`",
): number {
  let i = start + 1;

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "\\" && quote !== "`") {
      i += 2;
      continue;
    }

    if (char === quote) {
      if (next === quote) {
        i += 2;
        continue;
      }

      return i + 1;
    }

    i += 1;
  }

  return i;
}

function hasQueryLevelSettings(sql: string): boolean {
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "'" || char === '"' || char === "`") {
      i = skipQuoted(sql, i, char);
      continue;
    }

    if (char === "-" && next === "-") {
      const newlineIndex = sql.indexOf("\n", i + 2);
      i = newlineIndex === -1 ? sql.length : newlineIndex + 1;
      continue;
    }

    if (char === "/" && next === "*") {
      const commentEndIndex = sql.indexOf("*/", i + 2);
      i = commentEndIndex === -1 ? sql.length : commentEndIndex + 2;
      continue;
    }

    if (
      sql.slice(i, i + "settings".length).toLowerCase() === "settings" &&
      !isSqlWordChar(sql[i - 1]) &&
      !isSqlWordChar(sql[i + "settings".length])
    ) {
      return true;
    }

    i += 1;
  }

  return false;
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

        if (hasQueryLevelSettings(sql)) {
          return Response.json(
            { error: "Query-level SETTINGS are not allowed." },
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
