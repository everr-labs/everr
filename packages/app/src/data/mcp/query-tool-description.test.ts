import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({}));

import { SQL_API_TENANT_TABLES } from "@/lib/sql-api-tables";
import { QUERY_TOOL_DESCRIPTION } from "./query-tool-description";

describe("QUERY_TOOL_DESCRIPTION", () => {
  it.each(SQL_API_TENANT_TABLES)("documents the readable table %s", (table) => {
    expect(QUERY_TOOL_DESCRIPTION).toMatch(new RegExp(`\\b${table}\\b`));
  });
});
