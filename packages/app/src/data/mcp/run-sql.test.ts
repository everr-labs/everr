import { ClickHouseError } from "@clickhouse/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted so the hoisted vi.mock factory can reference this safely.
const { previewSqlApi } = vi.hoisted(() => ({ previewSqlApi: vi.fn() }));

vi.mock("@/lib/clickhouse", () => ({
  previewSqlApi: (...a: unknown[]) => previewSqlApi(...a),
}));

import { MCP_MAX_CELL_CHARS, MCP_MAX_ROWS } from "./query-tool-description";
import { runSqlForConnection } from "./run-sql";

beforeEach(() => previewSqlApi.mockReset());

function run(sql: string) {
  return runSqlForConnection({ orgId: "org-1", metadata: null, sql });
}

function chError(type: string, message: string) {
  return new ClickHouseError({ message, code: "0", type });
}

describe("runSqlForConnection", () => {
  it("rejects empty SQL", async () => {
    expect(await run(" ")).toEqual({
      isError: true,
      text: "SQL query is required.",
    });
  });

  it("rejects pending setup before issuing SQL", async () => {
    const result = await runSqlForConnection({
      orgId: "org-1",
      metadata: { clickhouseReady: false },
      sql: "SELECT 1",
    });
    expect(result.isError).toBe(true);
    expect(previewSqlApi).not.toHaveBeenCalled();
  });

  it("returns names, types, and one JSON array per row", async () => {
    previewSqlApi.mockResolvedValueOnce({
      columns: ["ServiceName", "c"],
      columnTypes: ["LowCardinality(String)", "UInt64"],
      rows: [
        ["api", "3"],
        ["web", "1"],
      ],
      truncated: false,
    });
    expect(await run("SELECT ServiceName, count() c FROM traces")).toEqual({
      isError: false,
      text: [
        '["ServiceName","c"]',
        '["LowCardinality(String)","UInt64"]',
        '["api","3"]',
        '["web","1"]',
      ].join("\n"),
      note: "2 rows.",
    });
    expect(previewSqlApi).toHaveBeenCalledWith(
      "SELECT ServiceName, count() c FROM traces",
      "org-1",
      MCP_MAX_ROWS,
    );
  });

  it("keeps the columns and adds a hint on an empty result", async () => {
    previewSqlApi.mockResolvedValueOnce({
      columns: ["a"],
      columnTypes: ["UInt8"],
      rows: [],
      truncated: false,
    });
    const r = await run("SELECT a");
    expect(r.text).toBe('["a"]\n["UInt8"]');
    expect(r.note).toMatch(/^0 rows\. Widen the time window/);
  });

  it("says when rows were cut and cuts long strings", async () => {
    previewSqlApi.mockResolvedValueOnce({
      columns: ["s"],
      columnTypes: ["String"],
      rows: [["x".repeat(MCP_MAX_CELL_CHARS + 10)]],
      truncated: true,
    });
    const r = await run("SELECT s");
    expect(r.text.split("\n")[2]).toBe(
      JSON.stringify([`${"x".repeat(MCP_MAX_CELL_CHARS - 1)}…[+11 chars]`]),
    );
    expect(r.note).toMatch(/^First 200 rows shown/);
  });

  it("returns a query error as is when no hint applies", async () => {
    previewSqlApi.mockRejectedValueOnce(new Error("Syntax error near FROM"));
    expect(await run("SELEC 1")).toEqual({
      isError: true,
      text: "Syntax error near FROM",
      note: undefined,
    });
  });

  it("adds a hint to an unknown column", async () => {
    previewSqlApi.mockRejectedValueOnce(
      chError("UNKNOWN_IDENTIFIER", "Unknown expression identifier `Foo`"),
    );
    const r = await run("SELECT Foo");
    expect(r).toMatchObject({
      isError: true,
      text: "Unknown expression identifier `Foo`",
    });
    expect(r.note).toMatch(/DESCRIBE TABLE/);
  });

  it("adds a hint when a raw JSON attribute is used", async () => {
    previewSqlApi.mockRejectedValueOnce(
      chError("ILLEGAL_COLUMN", "Column of type Dynamic is not allowed"),
    );
    expect((await run("SELECT 1")).note).toMatch(
      /^Attribute values are Dynamic/,
    );
  });
});
