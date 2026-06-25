import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted so the hoisted vi.mock factory can reference this safely.
const { querySqlApi } = vi.hoisted(() => ({ querySqlApi: vi.fn() }));

vi.mock("@/lib/clickhouse", () => ({
  querySqlApi: (...a: unknown[]) => querySqlApi(...a),
}));

import { runSqlForConnection } from "./mcp-run-sql";

beforeEach(() => querySqlApi.mockReset());

describe("runSqlForConnection", () => {
  it("rejects empty SQL", async () => {
    expect(await runSqlForConnection({ orgId: "o", sql: " " })).toEqual({
      isError: true,
      text: "SQL query is required.",
    });
  });

  it("returns NDJSON rows", async () => {
    querySqlApi.mockResolvedValueOnce([{ a: 1 }]);
    const r = await runSqlForConnection({
      orgId: "org-1",
      sql: "SELECT a FROM traces",
    });
    expect(r).toEqual({ isError: false, text: '{"a":1}' });
    expect(querySqlApi).toHaveBeenCalledWith("SELECT a FROM traces", "org-1");
  });

  it("sanitizes a query error", async () => {
    querySqlApi.mockRejectedValueOnce(new Error("Syntax error near FROM"));
    expect(
      await runSqlForConnection({ orgId: "org-1", sql: "SELEC 1" }),
    ).toEqual({ isError: true, text: "Syntax error near FROM" });
  });
});
