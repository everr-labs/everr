import { beforeEach, describe, expect, it, vi } from "vitest";
import { cliSessionContext, getRouteHandler } from "../-test-utils";

vi.mock("@/lib/clickhouse", () => ({
  querySqlApi: vi.fn(),
}));

import { querySqlApi } from "@/lib/clickhouse";
import { Route } from "./test";

const mockedQuerySqlApi = vi.mocked(querySqlApi);

type PostHandler = (args: {
  request: Request;
  context: ReturnType<typeof cliSessionContext>;
}) => Promise<Response>;

function postHandler(): PostHandler {
  return getRouteHandler<PostHandler>(Route, "POST", "/api/cli/alerts/test");
}

const body = {
  files: [
    {
      path: "alerts/high-5xx.yaml",
      content: `
kind: AlertRule
metadata:
  name: high-5xx-routes
  project: platform
spec:
  severity: critical
  evaluationInterval: 1m
  window: 5m
  summary: "\${row_count} routes have elevated 5xxs"
  query: "SELECT now() - INTERVAL \${window} AS cutoff"
`,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/alerts/test", () => {
  it("runs each AlertRule query through the tenant-scoped SQL API", async () => {
    mockedQuerySqlApi.mockResolvedValue([{ ok: 1 }]);

    const response = await postHandler()({
      request: new Request("http://localhost/api/cli/alerts/test", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      context: cliSessionContext("org-42"),
    });

    expect(response.status).toBe(200);
    expect(mockedQuerySqlApi).toHaveBeenCalledWith(
      "SELECT now() - INTERVAL 5 MINUTE AS cutoff",
      "org-42",
    );
    expect(await response.json()).toEqual({
      results: [
        {
          path: "alerts/high-5xx.yaml",
          project: "platform",
          name: "high-5xx-routes",
          severity: "critical",
          firing: true,
          rowCount: 1,
          truncated: false,
          evidence: [{ ok: 1 }],
        },
      ],
    });
  });

  it("returns firing false when the query returns no rows", async () => {
    mockedQuerySqlApi.mockResolvedValue([]);

    const response = await postHandler()({
      request: new Request("http://localhost/api/cli/alerts/test", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      context: cliSessionContext(),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).results[0]).toMatchObject({
      firing: false,
      rowCount: 0,
      evidence: [],
    });
  });

  it("returns 400 for invalid resources", async () => {
    const response = await postHandler()({
      request: new Request("http://localhost/api/cli/alerts/test", {
        method: "POST",
        body: JSON.stringify({
          files: [{ path: "bad.yaml", content: "kind: Nope" }],
        }),
      }),
      context: cliSessionContext(),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.stringContaining("Invalid discriminator value"),
    });
    expect(mockedQuerySqlApi).not.toHaveBeenCalled();
  });
});
