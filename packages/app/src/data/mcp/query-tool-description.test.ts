import { describe, expect, it } from "vite-plus/test";
import { SQL_API_TABLES, SQL_API_WITHHELD_COLUMNS } from "#app/lib/sql-api-tables.ts";
import { QUERY_TOOL_DESCRIPTION } from "./query-tool-description";

describe("QUERY_TOOL_DESCRIPTION", () => {
  it.each(SQL_API_TABLES)("documents the readable table %s", (table) => {
    expect(QUERY_TOOL_DESCRIPTION).toMatch(new RegExp(`\\b${table}\\b`));
  });

  it.each(Object.entries(SQL_API_WITHHELD_COLUMNS))(
    "says which columns of %s are not readable",
    (table, columns) => {
      const line = QUERY_TOOL_DESCRIPTION.split("\n").find((l) => l.startsWith(`- \`${table}\`:`));
      const names = columns.map((column) => `\`${column}\``).join(", ");

      expect(line).toContain(`Every column but ${names}`);
      expect(line).toContain("`SELECT *` and `DESCRIBE TABLE");
    },
  );
});
