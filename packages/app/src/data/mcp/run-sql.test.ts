import { ClickHouseError } from "@clickhouse/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted so the hoisted vi.mock factory can reference this safely.
const { previewSqlApi } = vi.hoisted(() => ({ previewSqlApi: vi.fn() }));

vi.mock("@/lib/clickhouse", () => ({ previewSqlApi }));

import {
  MCP_MAX_CELL_CHARS,
  MCP_MAX_OUTPUT_CHARS,
  MCP_MAX_ROWS,
} from "./query-tool-description";
import { runSqlForConnection } from "./run-sql";

beforeEach(() => previewSqlApi.mockReset());

function run(sql: string) {
  return runSqlForConnection({ orgId: "org-1", metadata: null, sql });
}

function chError(type: string, message: string, code = "0") {
  return new ClickHouseError({ message, code, type });
}

describe("runSqlForConnection", () => {
  it("rejects empty SQL", async () => {
    expect(await run(" ")).toEqual({
      isError: true,
      content: ["SQL query is required."],
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
      content: [
        [
          '["ServiceName","c"]',
          '["LowCardinality(String)","UInt64"]',
          '["api","3"]',
          '["web","1"]',
        ].join("\n"),
        "2 rows.",
      ],
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
    const [rows, note] = (await run("SELECT a")).content;
    expect(rows).toBe('["a"]\n["UInt8"]');
    expect(note).toMatch(/^0 rows\. Widen the time window/);
  });

  it("says when rows were cut and cuts long strings", async () => {
    previewSqlApi.mockResolvedValueOnce({
      columns: ["s"],
      columnTypes: ["String"],
      rows: [["x".repeat(MCP_MAX_CELL_CHARS + 10)]],
      truncated: true,
    });
    const [rows, note] = (await run("SELECT s")).content;
    expect(rows.split("\n")[2]).toBe(
      JSON.stringify([`${"x".repeat(MCP_MAX_CELL_CHARS - 1)}…[+11 chars]`]),
    );
    expect(note).toMatch(/^First 1 row shown/);
  });

  it("stops adding rows past the output budget", async () => {
    const wide = "x".repeat(MCP_MAX_CELL_CHARS);
    previewSqlApi.mockResolvedValueOnce({
      columns: ["a", "b", "c"],
      columnTypes: ["String", "String", "String"],
      rows: Array.from({ length: MCP_MAX_ROWS }, () => [wide, wide, wide]),
      truncated: false,
    });
    const [rows, note] = (await run("SELECT a, b, c")).content;
    expect(rows.length).toBeLessThanOrEqual(MCP_MAX_OUTPUT_CHARS);
    const shown = rows.split("\n").length - 2;
    expect(shown).toBeLessThan(MCP_MAX_ROWS);
    expect(note).toMatch(new RegExp(`^First ${shown} rows shown`));
  });

  it("returns a query error as is when no hint applies", async () => {
    previewSqlApi.mockRejectedValueOnce(new Error("Syntax error near FROM"));
    expect(await run("SELEC 1")).toEqual({
      isError: true,
      content: ["Syntax error near FROM"],
    });
  });

  it("adds a hint to an unknown column", async () => {
    previewSqlApi.mockRejectedValueOnce(
      chError("UNKNOWN_IDENTIFIER", "Unknown expression identifier `Foo`"),
    );
    const r = await run("SELECT Foo");
    expect(r.isError).toBe(true);
    expect(r.content[0]).toBe("Unknown expression identifier `Foo`");
    expect(r.content[1]).toMatch(/DESCRIBE TABLE/);
  });

  it("adds a hint when a raw JSON attribute is used", async () => {
    previewSqlApi.mockRejectedValueOnce(
      chError("ILLEGAL_COLUMN", "Column of type Dynamic is not allowed"),
    );
    expect((await run("SELECT 1")).content[1]).toMatch(
      /^Attribute values are Dynamic/,
    );
  });

  it("adds a hint to a timeout, classified by code", async () => {
    previewSqlApi.mockRejectedValueOnce(chError("", "Timeout exceeded", "159"));
    expect((await run("SELECT 1")).content[1]).toMatch(
      /^Narrow the time window/,
    );
  });
});
