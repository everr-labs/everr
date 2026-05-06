import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  queryWithClickHouseSettings: vi.fn(),
}));

import { queryWithClickHouseSettings } from "@/lib/clickhouse";
import { Route } from "./sql";

const mockedQueryWithClickHouseSettings = vi.mocked(
  queryWithClickHouseSettings,
);

type PostHandler = (args: {
  request: Request;
  context: { session: { session: { activeOrganizationId: string } } };
}) => Promise<Response>;

function getHandler(): PostHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { POST?: PostHandler } };
  };
  const handler = routeOptions.server?.handlers?.POST;
  if (!handler) throw new Error("Missing POST handler for /api/cli/sql.");
  return handler;
}

const context = { session: { session: { activeOrganizationId: "org-42" } } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/sql", () => {
  it("returns NDJSON rows for valid SQL", async () => {
    mockedQueryWithClickHouseSettings.mockResolvedValue([{ ok: 1 }]);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/sql", {
        method: "POST",
        body: "SELECT 1 AS ok",
        headers: { "content-type": "text/plain" },
      }),
      context,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/x-ndjson",
    );
    expect(mockedQueryWithClickHouseSettings).toHaveBeenCalledWith(
      "SELECT 1 AS ok",
      "org-42",
      {
        max_execution_time: 30,
        max_memory_usage: 200_000_000,
        max_result_bytes: 5_000_000,
        max_result_rows: 500,
        max_rows_to_read: 50_000,
        readonly: 1,
      },
    );
    expect(await response.text()).toBe('{"ok":1}\n');
  });

  it("returns 400 when SQL is empty", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/sql", {
        method: "POST",
        body: "   ",
        headers: { "content-type": "text/plain" },
      }),
      context,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "SQL query is required." });
    expect(mockedQueryWithClickHouseSettings).not.toHaveBeenCalled();
  });

  it.each([
    [
      "standard query-level SETTINGS",
      "SELECT 1 SETTINGS max_result_rows = 1000",
    ],
    [
      "tenant override query-level SETTINGS",
      "SELECT 1 SETTINGS SQL_everr_tenant_id = 'other-org'",
    ],
  ])("passes through SQL with %s", async (_name, sql) => {
    mockedQueryWithClickHouseSettings.mockResolvedValue([{ ok: 1 }]);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/sql", {
        method: "POST",
        body: sql,
        headers: { "content-type": "text/plain" },
      }),
      context,
    });

    expect(response.status).toBe(200);
    expect(mockedQueryWithClickHouseSettings).toHaveBeenCalledWith(
      sql,
      "org-42",
      {
        max_execution_time: 30,
        max_memory_usage: 200_000_000,
        max_result_bytes: 5_000_000,
        max_result_rows: 500,
        max_rows_to_read: 50_000,
        readonly: 1,
      },
    );
  });

  it("returns 400 when ClickHouse rejects the SQL", async () => {
    mockedQueryWithClickHouseSettings.mockRejectedValue(
      new Error("Syntax error near nope"),
    );

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/sql", {
        method: "POST",
        body: "SELECT nope",
        headers: { "content-type": "text/plain" },
      }),
      context,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Syntax error near nope",
    });
  });
});
