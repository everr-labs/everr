import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  querySqlApiWithMeta: vi.fn(),
}));

import { querySqlApiWithMeta } from "@/lib/clickhouse";
import {
  CLI_TEST_ORG_ID,
  cliSessionContext,
  getRouteHandler,
} from "../-test-utils";
import { Route } from "./test";

const mockedQuerySqlApiWithMeta = vi.mocked(querySqlApiWithMeta);

type PostHandler = (args: {
  request: Request;
  context: { session: { session: { activeOrganizationId: string } } };
}) => Promise<Response>;

function getHandler(): PostHandler {
  return getRouteHandler<PostHandler>(Route, "POST", "/api/cli/alerts/test");
}

function alert(overrides = {}) {
  return {
    kind: "AlertRule",
    metadata: { name: "high-errors" },
    spec: {
      evaluationInterval: "5m",
      window: "15m",
      summary: `\${row_count} errors in \${top_service}`,
      description: `route: \${top_route}`,
      query: `SELECT service, route, count() AS count FROM logs WHERE TimestampTime >= now() - INTERVAL \${window} GROUP BY service, route`,
      ...overrides,
    },
  };
}

function callAlertsTest(body: unknown) {
  return getHandler()({
    request: new Request("http://localhost/api/cli/alerts/test", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    context: cliSessionContext(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedQuerySqlApiWithMeta.mockResolvedValue({
    rows: [{ service: "api", route: "/login", count: 3 }],
    columns: ["service", "route", "count"],
  });
});

describe("/api/cli/alerts/test", () => {
  it("validates, executes, and returns bounded evidence", async () => {
    const response = await callAlertsTest({
      options: { local: true },
      alerts: [{ path: "alerts/high-errors.yaml", resource: alert() }],
    });

    expect(response.status).toBe(200);
    expect(mockedQuerySqlApiWithMeta).toHaveBeenCalledWith(
      expect.stringContaining("INTERVAL 15 MINUTE"),
      CLI_TEST_ORG_ID,
    );
    expect(await response.json()).toEqual({
      options: { local: true },
      results: [
        {
          path: "alerts/high-errors.yaml",
          slug: "high-errors",
          firing: true,
          rowCount: 1,
          columns: ["service", "route", "count"],
          evidence: [{ service: "api", route: "/login", count: 3 }],
          truncated: false,
        },
      ],
    });
  });

  it("returns 400 with file path for invalid schema", async () => {
    const response = await callAlertsTest({
      alerts: [{ path: "alerts/bad.yaml", resource: { kind: "AlertRule" } }],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.stringContaining("alerts/bad.yaml: invalid alert rule"),
    });
    expect(mockedQuerySqlApiWithMeta).not.toHaveBeenCalled();
  });

  it("returns 400 with file path for unsupported variables", async () => {
    const response = await callAlertsTest({
      alerts: [
        {
          path: "alerts/bad.yaml",
          resource: alert({ query: `SELECT \${repo}` }),
        },
      ],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.stringContaining("alerts/bad.yaml: unsupported query"),
    });
    expect(mockedQuerySqlApiWithMeta).not.toHaveBeenCalled();
  });

  it("returns 400 with file path when top column metadata is missing", async () => {
    mockedQuerySqlApiWithMeta.mockResolvedValueOnce({
      rows: [{ service: "api" }],
      columns: ["service"],
    });

    const response = await callAlertsTest({
      alerts: [{ path: "alerts/bad.yaml", resource: alert() }],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.stringContaining(
        `alerts/bad.yaml: \${top_route} references column "route"`,
      ),
    });
  });

  it("returns 400 with file path when ClickHouse rejects the query", async () => {
    mockedQuerySqlApiWithMeta.mockRejectedValueOnce(
      new Error("Syntax error near nope"),
    );

    const response = await callAlertsTest({
      alerts: [
        {
          path: "alerts/bad.yaml",
          resource: alert({ query: "SELECT nope" }),
        },
      ],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "alerts/bad.yaml: query failed: Syntax error near nope",
    });
  });
});
