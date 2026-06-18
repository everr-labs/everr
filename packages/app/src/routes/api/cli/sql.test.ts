import { ClickHouseError } from "@clickhouse/client";
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

  const SCHEMA_PROBE_MESSAGE =
    "Query references a table that doesn't exist or isn't available to you. " +
    "Readable tables: traces, logs, metrics_gauge, metrics_sum, " +
    "metrics_histogram, metrics_exponential_histogram, metrics_summary.";

  async function postSql(body: string) {
    return getHandler()({
      request: new Request("http://localhost/api/cli/sql", {
        method: "POST",
        body,
        headers: { "content-type": "text/plain" },
      }),
      context,
    });
  }

  it.each([
    [
      "ACCESS_DENIED",
      "497",
      "sql_api_org_PKeXt: Not enough privileges. To execute this query, it's " +
        "necessary to have the grant SELECT(tenant_id, traces_days, logs_days, " +
        "metrics_days) ON app.tenant_retention. ",
    ],
    [
      "UNKNOWN_TABLE",
      "60",
      "Unknown table expression identifier 'app.tenant_retention' in scope " +
        "SELECT * FROM app.tenant_retention",
    ],
    ["UNKNOWN_DATABASE", "81", "Database secret_db does not exist."],
  ])("collapses %s into a uniform message that leaks no schema", async (type, code, rawMessage) => {
    mockedQuerySqlApi.mockRejectedValue(
      new ClickHouseError({ message: rawMessage, code, type }),
    );

    const response = await postSql("SELECT * FROM app.tenant_retention");
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe(SCHEMA_PROBE_MESSAGE);
    // The raw error must not reach the client: no table/column names, no
    // per-org ClickHouse username, no "exists vs not" distinction.
    expect(body.error).not.toContain("tenant_retention");
    expect(body.error).not.toContain("traces_days");
    expect(body.error).not.toContain("sql_api_org_");
  });

  it("matches schema-probe errors even when the type is unparsed", async () => {
    mockedQuerySqlApi.mockRejectedValue(
      new ClickHouseError({
        message: "Not enough privileges ... ON app.tenant_retention.",
        code: "497",
        type: undefined,
      }),
    );

    const response = await postSql("SELECT * FROM app.tenant_retention");
    expect(await response.json()).toEqual({ error: SCHEMA_PROBE_MESSAGE });
  });

  it("passes through non-schema ClickHouse errors so callers can self-correct", async () => {
    mockedQuerySqlApi.mockRejectedValue(
      new ClickHouseError({
        message: "Unknown identifier 'srvice_name' in scope SELECT srvice_name",
        code: "47",
        type: "UNKNOWN_IDENTIFIER",
      }),
    );

    const response = await postSql("SELECT srvice_name FROM traces");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Unknown identifier 'srvice_name' in scope SELECT srvice_name",
    });
  });
});
