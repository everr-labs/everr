import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockQuery, mockInsert, mockCommand, mockJson, mockInstrumentClickhouseOperation } =
  vi.hoisted(() => ({
    mockQuery: vi.fn(),
    mockInsert: vi.fn(),
    mockCommand: vi.fn(),
    mockJson: vi.fn(),
    mockInstrumentClickhouseOperation: vi.fn(
      async (_attributes: unknown, run: () => Promise<unknown>) => run(),
    ),
  }));

vi.mock("@clickhouse/client", () => ({
  createClient: vi.fn(() => ({
    query: mockQuery,
    insert: mockInsert,
    command: mockCommand,
  })),
}));

vi.mock("@composition/storage", () => ({
  storage: {
    appQuerySettings: (_organizationId: string, settings: unknown) => settings,
    sqlApiAccess: () => ({
      auth: { username: "sql_api", password: "password" },
    }),
    telemetryTenantId: () => undefined,
  },
}));

vi.mock("#app/env/index.ts", () => ({
  env: {
    CLICKHOUSE_URL: "http://localhost:8123",
    CLICKHOUSE_USERNAME: "default",
    CLICKHOUSE_PASSWORD: "password",
    CLICKHOUSE_DATABASE: "default",
    CLICKHOUSE_ADMIN_USERNAME: "web_app_admin",
    CLICKHOUSE_ADMIN_PASSWORD: "web-app-admin-password",
  },
}));

vi.mock("#app/telemetry/clickhouse.ts", () => ({
  instrumentClickhouseOperation: mockInstrumentClickhouseOperation,
}));

vi.unmock("#app/lib/clickhouse.ts");

import { query, querySqlApi, querySqlApiWithMeta } from "#app/lib/clickhouse.ts";
import { adminCommand, insertRows } from "#app/lib/clickhouse-writer.ts";

const ORG = "org42";
beforeEach(() => {
  vi.clearAllMocks();
  mockInstrumentClickhouseOperation.mockImplementation(
    async (_attributes: unknown, run: () => Promise<unknown>) => run(),
  );
  mockJson.mockReturnValue([]);
  mockQuery.mockResolvedValue({ json: mockJson });
  mockCommand.mockResolvedValue(undefined);
});

describe("query", () => {
  it("wraps app ClickHouse reads in telemetry", async () => {
    await query("SELECT {n:UInt8}", ORG, { n: 1 });

    expect(mockInstrumentClickhouseOperation).toHaveBeenCalledWith(
      {
        client: "app",
        operation: "QUERY",
      },
      expect.any(Function),
    );
  });

  it("forwards caller-supplied query settings", async () => {
    await query("SELECT 1", ORG, undefined, { max_execution_time: 30 });
    expect(mockQuery).toHaveBeenCalledWith({
      query: "SELECT 1",
      query_params: undefined,
      format: "JSONEachRow",
      clickhouse_settings: { max_execution_time: 30 },
    });
  });
});

describe("querySqlApi", () => {
  it("authenticates with configured credentials and forwards query params", async () => {
    await querySqlApi("SELECT {n:UInt8}", ORG, { n: 1 });

    expect(mockInstrumentClickhouseOperation).toHaveBeenCalledWith(
      {
        client: "sql_api",
        operation: "QUERY",
      },
      expect.any(Function),
    );
    expect(mockQuery).toHaveBeenCalledWith({
      query: "SELECT {n:UInt8}",
      query_params: { n: 1 },
      format: "JSONEachRow",
      auth: { username: "sql_api", password: "password" },
    });
  });

  it("rejects when tenant id is missing", async () => {
    await expect(querySqlApi("SELECT 1", "")).rejects.toThrow(/workspace context/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("querySqlApiWithMeta", () => {
  it("uses JSON format so column metadata is available for empty results", async () => {
    mockJson.mockResolvedValueOnce({
      meta: [
        { name: "route", type: "String" },
        { name: "n", type: "UInt64" },
      ],
      data: [],
    });

    await expect(querySqlApiWithMeta("SELECT 1", ORG)).resolves.toEqual({
      rows: [],
      columns: ["route", "n"],
      columnTypes: ["String", "UInt64"],
    });

    expect(mockQuery).toHaveBeenCalledWith({
      query: "SELECT 1",
      query_params: undefined,
      format: "JSON",
      auth: { username: "sql_api", password: "password" },
    });
  });
});

describe("insertRows", () => {
  it("writes rows through the admin client with the given settings", async () => {
    await insertRows(
      "app.logs",
      [
        {
          organizationId: ORG,
          service_name: "everr",
          body: "hello",
        },
      ],
      { async_insert: 1, wait_for_async_insert: 1 },
    );

    expect(mockInsert).toHaveBeenCalledWith({
      table: "app.logs",
      values: [
        {
          service_name: "everr",
          body: "hello",
        },
      ],
      format: "JSONEachRow",
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 1,
      },
    });
  });

  it("does not issue an insert for an empty batch", async () => {
    await insertRows("app.logs", []);

    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("adminCommand", () => {
  it("wraps admin commands in telemetry and forwards options", async () => {
    const signal = new AbortController().signal;
    await adminCommand("SELECT 1", { abort_signal: signal });
    expect(mockInstrumentClickhouseOperation).toHaveBeenCalledWith(
      { client: "admin", operation: "QUERY" },
      expect.any(Function),
    );
    expect(mockCommand).toHaveBeenCalledWith({
      query: "SELECT 1",
      abort_signal: signal,
    });
  });
});
