import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  querySqlApi: vi.fn(),
}));

import { querySqlApi } from "@/lib/clickhouse";
import { Route } from "./sql";

const mockedQuerySqlApi = vi.mocked(querySqlApi);

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
    mockedQuerySqlApi.mockResolvedValue([{ ok: 1 }]);

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
    expect(mockedQuerySqlApi).toHaveBeenCalledWith("SELECT 1 AS ok", "org-42");
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
    expect(mockedQuerySqlApi).not.toHaveBeenCalled();
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
    mockedQuerySqlApi.mockResolvedValue([{ ok: 1 }]);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/sql", {
        method: "POST",
        body: sql,
        headers: { "content-type": "text/plain" },
      }),
      context,
    });

    expect(response.status).toBe(200);
    expect(mockedQuerySqlApi).toHaveBeenCalledWith(sql, "org-42");
  });

  it("returns 400 when ClickHouse rejects the SQL", async () => {
    mockedQuerySqlApi.mockRejectedValue(new Error("Syntax error near nope"));

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
