import { ClickHouseError } from "@clickhouse/client";
import { storage } from "@composition/storage";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { StorageNotReadyError } from "#app/common/storage-readiness.ts";

// vi.hoisted so the hoisted vi.mock factory can reference this safely.

import { MCP_MAX_CELL_CHARS, MCP_MAX_OUTPUT_CHARS, MCP_MAX_ROWS } from "./query-tool-description";
import { runSqlForConnection } from "./run-sql";

const principal = {
  kind: "member",
  organizationId: "org-1",
  userId: "u",
  membershipId: "m",
  authorization: "current-membership",
} as const;
const { assertStorageReady } = storage;
vi.mock("@composition/storage", () => ({
  storage: { assertStorageReady: vi.fn() },
}));
const { previewSqlApi, observe } = vi.hoisted(() => ({ previewSqlApi: vi.fn(), observe: vi.fn() }));
vi.mock("#app/server/organizations/consultations.ts", () => ({ consultations: { observe } }));
vi.mock("#app/lib/clickhouse.ts", () => ({ previewSqlApi }));

beforeEach(() => {
  observe.mockReset();
  vi.mocked(assertStorageReady).mockReset();
  previewSqlApi.mockReset();
});

function run(sql: string) {
  return runSqlForConnection({ principal, orgId: "org-1", metadata: null, sql });
}

function chError(type: string, message: string, code = "0") {
  return new ClickHouseError({ message, code, type });
}

describe("runSqlForConnection", () => {
  it("rejects empty SQL before checking storage readiness", async () => {
    expect(await run(" ")).toEqual({
      isError: true,
      content: ["SQL query is required."],
    });
    expect(assertStorageReady).not.toHaveBeenCalled();
    expect(previewSqlApi).not.toHaveBeenCalled();
  });

  it("rejects pending setup before issuing SQL", async () => {
    vi.mocked(assertStorageReady).mockImplementationOnce(() => {
      throw new StorageNotReadyError();
    });
    const result = await runSqlForConnection({
      principal,
      orgId: "org-1",
      metadata: { clickhouseReady: false },
      sql: "SELECT 1",
    });
    expect(result.content[0]).toBe("Storage is not ready.");
    expect(result.isError).toBe(true);
    expect(assertStorageReady).toHaveBeenCalledWith({ clickhouseReady: false });
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

  it("rejects a header that alone exceeds the output budget", async () => {
    const columns = Array.from({ length: MCP_MAX_OUTPUT_CHARS / 10 }, (_, i) => `column_${i}`);
    previewSqlApi.mockResolvedValueOnce({
      columns,
      columnTypes: columns.map(() => "String"),
      rows: [],
      truncated: false,
    });
    const result = await run("SELECT *");
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatch(/Select fewer columns/);
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
    expect((await run("SELECT 1")).content[1]).toMatch(/^Attribute values are Dynamic/);
  });

  it("adds a hint to a timeout, classified by code", async () => {
    previewSqlApi.mockRejectedValueOnce(chError("", "Timeout exceeded", "159"));
    expect((await run("SELECT 1")).content[1]).toMatch(/^Narrow the time window/);
  });
});

describe("MCP consultation completion", () => {
  const traceId = "0123456789abcdef0123456789abcdef";
  const sql = `SELECT * FROM traces WHERE TraceId = '${traceId}' ORDER BY Timestamp LIMIT 10`;
  const preview = {
    columns: ["TraceId", "ServiceName", "ResourceAttributes", "SpanAttributes"],
    columnTypes: ["String", "String", "JSON", "JSON"],
    rows: [[traceId, "checkout", { "deployment.environment.name": "production" }, {}]],
    truncated: false,
  };
  it("observes successful shown trace rows with the actual Member principal", async () => {
    previewSqlApi.mockResolvedValue(preview);
    expect((await run(sql)).isError).toBe(false);
    expect(observe).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        organizationId: "org-1",
        principal,
        trigger: "agent-request",
        evidence: expect.objectContaining({ surface: "mcp" }),
      }),
    );
  });
  it("preserves a successful tool response if observation throws", async () => {
    previewSqlApi.mockResolvedValue(preview);
    observe.mockImplementation(() => {
      throw new Error("private error");
    });
    const result = await run(sql);
    expect(result.isError).toBe(false);
    expect(result.content[0]).toContain(traceId);
  });
  it("cannot observe a supplied principal for a different Organization", async () => {
    previewSqlApi.mockResolvedValue(preview);
    const result = await runSqlForConnection({ orgId: "other", principal, metadata: null, sql });
    expect(result.isError).toBe(false);
    expect(observe).not.toHaveBeenCalled();
  });
  it.each([
    "SELECT 1",
    "DESCRIBE traces",
    "SELECT * FROM traces LIMIT 1",
    "SELECT count() FROM workflow_runs",
  ])("does not observe metadata, probes or polling/list query %s", async (body) => {
    previewSqlApi.mockResolvedValue(preview);
    expect((await run(body)).isError).toBe(false);
    expect(observe).not.toHaveBeenCalled();
  });
  it("does not observe rows excluded by the MCP response budget", async () => {
    const columns = [...preview.columns, ...Array.from({ length: 30 }, (_, i) => `wide${i}`)];
    previewSqlApi.mockResolvedValue({
      ...preview,
      columns,
      columnTypes: columns.map(() => "String"),
      rows: [
        [...preview.rows[0], ...Array.from({ length: 30 }, () => "x".repeat(MCP_MAX_CELL_CHARS))],
      ],
    });
    const result = await run(sql);
    expect(result.isError).toBe(false);
    expect(result.content[0]).not.toContain(traceId);
    expect(observe).not.toHaveBeenCalled();
  });
});
