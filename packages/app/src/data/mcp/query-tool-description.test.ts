import { describe, expect, it } from "vite-plus/test";
import { SQL_API_TABLE_COLUMNS, SQL_API_TABLES } from "#app/lib/sql-api-tables.ts";
import { QUERY_TOOL_DESCRIPTION } from "./query-tool-description";

describe("QUERY_TOOL_DESCRIPTION", () => {
  it.each(SQL_API_TABLES)("documents the readable table %s", (table) => {
    expect(QUERY_TOOL_DESCRIPTION).toMatch(new RegExp(`\\b${table}\\b`));
  });

  it.each(Object.entries(SQL_API_TABLE_COLUMNS))(
    "documents exactly the readable columns of %s",
    (table, columns) => {
      const line = QUERY_TOOL_DESCRIPTION.split("\n").find((l) => l.startsWith(`- \`${table}\`:`));
      expect(line).toBeDefined();
      const listed = /Columns: ([^.]*)\./.exec(line ?? "")?.[1] ?? "";
      expect([...listed.matchAll(/`(\w+)`/g)].map((m) => m[1])).toEqual([...columns]);
    },
  );
});
