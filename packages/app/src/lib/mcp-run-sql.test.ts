import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted so the hoisted vi.mock factories can reference these safely.
const { resolveMcpOrg, querySqlApi } = vi.hoisted(() => ({
  resolveMcpOrg: vi.fn(),
  querySqlApi: vi.fn(),
}));

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/mcp-org", async () => {
  const actual = await vi.importActual<typeof import("./mcp-org")>("./mcp-org");
  return { ...actual, resolveMcpOrg: (...a: unknown[]) => resolveMcpOrg(...a) };
});
vi.mock("@/lib/clickhouse", () => ({
  querySqlApi: (...a: unknown[]) => querySqlApi(...a),
}));

import { McpOrgError } from "./mcp-org";
import { runSqlForConnection } from "./mcp-run-sql";

beforeEach(() => {
  resolveMcpOrg.mockReset();
  querySqlApi.mockReset();
});

describe("runSqlForConnection", () => {
  it("rejects empty SQL without touching the db", async () => {
    const r = await runSqlForConnection({ userId: "u", sql: "  " });
    expect(r).toEqual({ isError: true, text: "SQL query is required." });
    expect(resolveMcpOrg).not.toHaveBeenCalled();
  });

  it("returns NDJSON rows on success", async () => {
    resolveMcpOrg.mockResolvedValueOnce("org-1");
    querySqlApi.mockResolvedValueOnce([{ a: 1 }, { a: 2 }]);
    const r = await runSqlForConnection({
      userId: "u",
      sql: "SELECT a FROM traces",
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('{"a":1}\n{"a":2}');
    expect(querySqlApi).toHaveBeenCalledWith("SELECT a FROM traces", "org-1");
  });

  it("surfaces a no-org error as a tool error", async () => {
    resolveMcpOrg.mockRejectedValueOnce(new McpOrgError("no org"));
    const r = await runSqlForConnection({ userId: "u", sql: "SELECT 1" });
    expect(r).toEqual({ isError: true, text: "no org" });
  });

  it("sanitizes a ClickHouse query error", async () => {
    resolveMcpOrg.mockResolvedValueOnce("org-1");
    querySqlApi.mockRejectedValueOnce(new Error("Syntax error near FROM"));
    const r = await runSqlForConnection({ userId: "u", sql: "SELEC 1" });
    expect(r).toEqual({ isError: true, text: "Syntax error near FROM" });
  });
});
