import { ClickHouseError } from "@clickhouse/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted so the hoisted vi.mock factory can reference this safely.
const { querySqlApiWithMeta } = vi.hoisted(() => ({
  querySqlApiWithMeta: vi.fn(),
}));

vi.mock("@/lib/clickhouse", () => ({
  querySqlApiWithMeta: (...a: unknown[]) => querySqlApiWithMeta(...a),
}));

import {
  MCP_MAX_CELL_CHARS,
  MCP_MAX_ROWS,
  runSqlForConnection,
} from "./run-sql";

beforeEach(() => querySqlApiWithMeta.mockReset());

function chError(type: string, message: string) {
  return new ClickHouseError({ message, code: "0", type });
}

describe("runSqlForConnection", () => {
  it("rejects empty SQL", async () => {
    expect(
      await runSqlForConnection({ orgId: "o", metadata: null, sql: " " }),
    ).toEqual({
      isError: true,
      text: "SQL query is required.",
    });
  });

  it("returns a typed header and one JSON array per row", async () => {
    querySqlApiWithMeta.mockResolvedValueOnce({
      rows: [
        { ServiceName: "api", c: "3" },
        { ServiceName: "web", c: "1" },
      ],
      columns: ["ServiceName", "c"],
      columnTypes: ["LowCardinality(String)", "UInt64"],
    });
    const r = await runSqlForConnection({
      orgId: "org-1",
      metadata: null,
      sql: "SELECT ServiceName, count() c FROM traces",
    });
    expect(r).toEqual({
      isError: false,
      text: [
        'columns: {"ServiceName":"LowCardinality(String)","c":"UInt64"}',
        '["api","3"]',
        '["web","1"]',
        "(2 rows)",
      ].join("\n"),
    });
    expect(querySqlApiWithMeta).toHaveBeenCalledWith(
      "SELECT ServiceName, count() c FROM traces",
      "org-1",
    );
  });

  it("keeps the columns and adds a hint on an empty result", async () => {
    querySqlApiWithMeta.mockResolvedValueOnce({
      rows: [],
      columns: ["a"],
      columnTypes: ["UInt8"],
    });
    const r = await runSqlForConnection({
      orgId: "o",
      metadata: null,
      sql: "SELECT a",
    });
    expect(r.text).toMatch(/^columns: \{"a":"UInt8"\}\n\(0 rows\)\nHint: /);
  });

  it("caps rows and long strings", async () => {
    querySqlApiWithMeta.mockResolvedValueOnce({
      rows: Array.from({ length: MCP_MAX_ROWS + 5 }, () => ({
        s: "x".repeat(MCP_MAX_CELL_CHARS + 10),
      })),
      columns: ["s"],
      columnTypes: ["String"],
    });
    const lines = (
      await runSqlForConnection({ orgId: "o", metadata: null, sql: "SELECT s" })
    ).text.split("\n");
    expect(lines).toHaveLength(MCP_MAX_ROWS + 2);
    expect(lines[1]).toBe(
      JSON.stringify([`${"x".repeat(MCP_MAX_CELL_CHARS)}…[+10 chars]`]),
    );
    expect(lines.at(-1)).toBe(
      `(${MCP_MAX_ROWS} of ${MCP_MAX_ROWS + 5} rows shown. Aggregate or add a smaller LIMIT.)`,
    );
  });

  it("returns a query error as is when no hint applies", async () => {
    querySqlApiWithMeta.mockRejectedValueOnce(
      new Error("Syntax error near FROM"),
    );
    expect(
      await runSqlForConnection({
        orgId: "org-1",
        metadata: null,
        sql: "SELEC 1",
      }),
    ).toEqual({ isError: true, text: "Syntax error near FROM" });
  });

  it("adds a hint to an unknown column", async () => {
    querySqlApiWithMeta.mockRejectedValueOnce(
      chError("UNKNOWN_IDENTIFIER", "Unknown expression identifier `Foo`"),
    );
    const r = await runSqlForConnection({
      orgId: "o",
      metadata: null,
      sql: "SELECT Foo",
    });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(
      /^Unknown expression identifier `Foo`\nHint: run DESCRIBE TABLE/,
    );
  });

  it("adds a hint when a raw JSON attribute is used", async () => {
    querySqlApiWithMeta.mockRejectedValueOnce(
      chError("ILLEGAL_COLUMN", "Column of type Dynamic is not allowed"),
    );
    const r = await runSqlForConnection({
      orgId: "o",
      metadata: null,
      sql: "SELECT 1",
    });
    expect(r.text).toContain("Hint: attribute values are Dynamic");
  });

  it("rejects pending setup before issuing SQL", async () => {
    const result = await runSqlForConnection({
      orgId: "org-1",
      metadata: { clickhouseReady: false },
      sql: "SELECT 1",
    });
    expect(result.isError).toBe(true);
    expect(querySqlApiWithMeta).not.toHaveBeenCalled();
  });
});
