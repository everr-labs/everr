import { describe, expect, it } from "vite-plus/test";
import { SQL_API_TABLES } from "#app/lib/sql-api-tables.ts";
import { QUERY_TOOL_DESCRIPTION } from "./query-tool-description";

describe("QUERY_TOOL_DESCRIPTION", () => {
  it.each(SQL_API_TABLES)("documents the readable table %s", (table) => {
    expect(QUERY_TOOL_DESCRIPTION).toMatch(new RegExp(`\\b${table}\\b`));
  });
});
