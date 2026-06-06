import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLI_TEST_ORG_ID,
  cliSessionContext,
  getRouteHandler,
} from "../-test-utils";

vi.mock("@/lib/clickhouse", () => ({
  querySqlApi: vi.fn(),
}));

import { querySqlApi } from "@/lib/clickhouse";
import { Route } from "./test";

const mockedQuerySqlApi = vi.mocked(querySqlApi);
const fixtureDir = join(__dirname, "../../../../server/alerts/__fixtures__");

type PostHandler = (args: {
  request: Request;
  context: ReturnType<typeof cliSessionContext>;
}) => Promise<Response>;

function getHandler(): PostHandler {
  return getRouteHandler<PostHandler>(Route, "POST", "/api/cli/alerts/test");
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
});

describe("/api/cli/alerts/test", () => {
  it("returns 400 when YAML is missing", async () => {
    const response = await callAlertsTest({});

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "rawYaml is required." });
    expect(mockedQuerySqlApi).not.toHaveBeenCalled();
  });

  it("runs each valid alert query once and returns cloud test results", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      route: `/route-${i}`,
      error_count: 10 + i,
    }));
    mockedQuerySqlApi.mockResolvedValueOnce(rows);

    const rawYaml = readFileSync(join(fixtureDir, "valid-alerts.yaml"), "utf8");
    const response = await callAlertsTest({ rawYaml });

    expect(response.status).toBe(200);
    expect(mockedQuerySqlApi).toHaveBeenCalledOnce();
    expect(mockedQuerySqlApi.mock.calls[0]?.[0]).toContain("INTERVAL 5 MINUTE");
    expect(mockedQuerySqlApi.mock.calls[0]?.[1]).toBe(CLI_TEST_ORG_ID);

    const body = await response.json();
    expect(body.filters).toEqual({ target: "cloud" });
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0]).toMatchObject({
      service: "api",
      name: "high-5xx-routes",
      severity: "critical",
      routing: "admins",
      firing: true,
      rowCount: 100,
      truncated: true,
    });
    expect(body.alerts[0].evidence.length).toBeLessThanOrEqual(50);
  });
});
