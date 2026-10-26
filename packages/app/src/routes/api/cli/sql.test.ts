import { ClickHouseError } from "@clickhouse/client";
import { storage } from "@composition/storage";
import { trace } from "@opentelemetry/api";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { StorageNotReadyError } from "#app/common/storage-readiness.ts";

import { querySqlApi } from "#app/lib/clickhouse.ts";
import { SCHEMA_PROBE_MESSAGE } from "#app/lib/sql-api-error.ts";
import { Route } from "./sql";

const { observe } = vi.hoisted(() => ({ observe: vi.fn() }));
vi.mock("#app/server/organizations/consultations.ts", () => ({ consultations: { observe } }));
const { assertStorageReady } = storage;
vi.mock("@composition/storage", () => ({
  storage: { assertStorageReady: vi.fn() },
}));
vi.mock("#app/lib/clickhouse.ts", () => ({
  querySqlApi: vi.fn(),
}));

const mockedQuerySqlApi = vi.mocked(querySqlApi);

type PostHandler = (args: {
  request: Request;
  context: {
    consultationPrincipal: typeof principal;
    organization: { metadata: unknown };
    session: { session: { activeOrganizationId: string } };
  };
}) => Promise<Response>;

function getHandler(): PostHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { POST?: PostHandler } };
  };
  const handler = routeOptions.server?.handlers?.POST;
  if (!handler) throw new Error("Missing POST handler for /api/cli/sql.");
  return handler;
}

const principal = {
  kind: "member",
  organizationId: "org-42",
  userId: "u",
  membershipId: "m",
} as const;
const context = {
  consultationPrincipal: principal,
  organization: { metadata: null },
  session: { session: { activeOrganizationId: "org-42" } },
};
const span = { setAttribute: vi.fn(), setStatus: vi.fn() };

beforeEach(() => {
  observe.mockReset();
  vi.clearAllMocks();
  vi.spyOn(trace, "getActiveSpan").mockReturnValue(span as never);
});

describe("/api/cli/sql", () => {
  it("returns a friendly retryable response while organization setup is pending", async () => {
    vi.mocked(assertStorageReady).mockImplementationOnce(() => {
      throw new StorageNotReadyError();
    });
    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/sql", {
        method: "POST",
        body: "SELECT 1",
      }),
      context: {
        ...context,
        organization: { metadata: { clickhouseReady: false } },
      },
    });
    expect(mockedQuerySqlApi).not.toHaveBeenCalled();
    expect(assertStorageReady).toHaveBeenCalledWith({ clickhouseReady: false });
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await response.json()).toEqual({
      error: "Storage is not ready.",
    });
    expect(span.setAttribute).toHaveBeenCalledWith("everr.sql_query.outcome", "user_error");
    expect(span.setAttribute).toHaveBeenCalledWith("everr.sql_query.kind", "account_setup");
    expect(span.setStatus).not.toHaveBeenCalled();
  });
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
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(mockedQuerySqlApi).toHaveBeenCalledWith("SELECT 1 AS ok", "org-42", undefined);
    expect(await response.text()).toBe('{"ok":1}\n');
  });

  it("returns 400 for empty SQL before checking storage readiness", async () => {
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
    expect(assertStorageReady).not.toHaveBeenCalled();
    expect(mockedQuerySqlApi).not.toHaveBeenCalled();
  });

  it.each([
    ["standard query-level SETTINGS", "SELECT 1 SETTINGS max_result_rows = 1000"],
    ["tenant override query-level SETTINGS", "SELECT 1 SETTINGS SQL_everr_tenant_id = 'other-org'"],
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
    expect(mockedQuerySqlApi).toHaveBeenCalledWith(sql, "org-42", undefined);
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
        "necessary to have the grant SELECT(private_value) ON app.private_records. ",
    ],
    [
      "UNKNOWN_TABLE",
      "60",
      "Unknown table expression identifier 'app.private_records' in scope " +
        "SELECT * FROM app.private_records",
    ],
    ["UNKNOWN_DATABASE", "81", "Database secret_db does not exist."],
  ])("collapses %s into a uniform message that leaks no schema", async (type, code, rawMessage) => {
    mockedQuerySqlApi.mockRejectedValue(new ClickHouseError({ message: rawMessage, code, type }));

    const response = await postSql("SELECT * FROM app.private_records");
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe(SCHEMA_PROBE_MESSAGE);
    // The raw error must not reach the client: no table/column names, no
    // per-org ClickHouse username, no "exists vs not" distinction.
    expect(body.error).not.toContain("private_records");
    expect(body.error).not.toContain("private_value");
    expect(body.error).not.toContain("sql_api_org_");
  });

  it("matches schema-probe errors even when the type is unparsed", async () => {
    mockedQuerySqlApi.mockRejectedValue(
      new ClickHouseError({
        message: "Not enough privileges ... ON app.private_records.",
        code: "497",
        type: undefined,
      }),
    );

    const response = await postSql("SELECT * FROM app.private_records");
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

describe("CLI consultation completion", () => {
  const traceId = "0123456789abcdef0123456789abcdef";
  const sql = `SELECT * FROM traces WHERE TraceId = '${traceId}' LIMIT 10`;
  const row = {
    TraceId: traceId,
    ServiceName: "checkout",
    ResourceAttributes: { "deployment.environment.name": "production" },
    SpanAttributes: {},
  };
  async function post(body: string, authorizedContext = context) {
    return getHandler()({
      request: new Request("http://localhost/api/cli/sql", { method: "POST", body }),
      context: authorizedContext,
    });
  }
  it("observes successful own-data detail using the authorized context", async () => {
    mockedQuerySqlApi.mockResolvedValue([row]);
    const response = await post(sql);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(traceId);
    expect(observe).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        principal,
        surface: "cli",
      }),
    );
  });
  it("contains observer failure without changing successful NDJSON", async () => {
    mockedQuerySqlApi.mockResolvedValue([row]);
    observe.mockImplementation(() => {
      throw new Error("secret diagnostic");
    });
    const response = await post(sql);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(JSON.stringify(row) + "\n");
  });
  it.each([
    "SELECT 1",
    "SELECT count() FROM traces",
    "SELECT * FROM workflow_runs LIMIT 1",
    "DESCRIBE traces",
  ])("leaves probes, metadata and automatic/list reads unobserved: %s", async (body) => {
    mockedQuerySqlApi.mockResolvedValue([row]);
    expect((await post(body)).status).toBe(200);
    expect(observe).not.toHaveBeenCalled();
  });
  it("does not observe an empty successful result", async () => {
    mockedQuerySqlApi.mockResolvedValue([]);
    expect((await post(sql)).status).toBe(200);
    expect(observe).not.toHaveBeenCalled();
  });
});
