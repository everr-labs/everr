import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cliSessionContext, getRouteHandler } from "../-test-utils";

vi.mock("@/lib/clickhouse", () => ({
  querySqlApi: vi.fn(),
}));

vi.mock("@/server/alerts/repository", () => ({
  upsertAlertDefinitions: vi.fn(),
}));

vi.mock("@/server/alerts/routing", () => ({
  routingListExists: vi.fn(),
}));

import { querySqlApi } from "@/lib/clickhouse";
import { upsertAlertDefinitions } from "@/server/alerts/repository";
import { routingListExists } from "@/server/alerts/routing";
import { Route } from "./upload";

const mockedQuerySqlApi = vi.mocked(querySqlApi);
const mockedRoutingListExists = vi.mocked(routingListExists);
const mockedUpsertAlertDefinitions = vi.mocked(upsertAlertDefinitions);
const fixtureDir = join(__dirname, "../../../../server/alerts/__fixtures__");

type PostHandler = (args: {
  request: Request;
  context: {
    session: {
      session: { activeOrganizationId: string; userId: string };
      user: { id: string };
    };
  };
}) => Promise<Response>;

function getHandler(): PostHandler {
  return getRouteHandler<PostHandler>(Route, "POST", "/api/cli/alerts/upload");
}

const context = {
  session: {
    ...cliSessionContext().session,
    session: {
      ...cliSessionContext().session.session,
      userId: "user-1",
    },
    user: { id: "user-1" },
  },
};

function callAlertsUpload(body: unknown) {
  return getHandler()({
    request: new Request("http://localhost/api/cli/alerts/upload", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    context,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/alerts/upload", () => {
  it("returns 400 when an alert references an unknown routing list", async () => {
    mockedRoutingListExists.mockResolvedValueOnce(false);
    const rawYaml = readFileSync(join(fixtureDir, "valid-alerts.yaml"), "utf8");

    const response = await callAlertsUpload({
      rawYaml,
      sourceUrl: "https://github.com/acme/repo/blob/main/alerts.yaml",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Unknown routing list "admins".',
    });
    expect(mockedQuerySqlApi).not.toHaveBeenCalled();
    expect(mockedUpsertAlertDefinitions).not.toHaveBeenCalled();
  });

  it("returns 400 when SQL validation fails", async () => {
    mockedRoutingListExists.mockResolvedValueOnce(true);
    mockedQuerySqlApi.mockRejectedValueOnce(new Error("Syntax error"));
    const rawYaml = readFileSync(join(fixtureDir, "valid-alerts.yaml"), "utf8");

    const response = await callAlertsUpload({
      rawYaml,
      sourceUrl: "https://github.com/acme/repo/blob/main/alerts.yaml",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Syntax error" });
    expect(mockedUpsertAlertDefinitions).not.toHaveBeenCalled();
  });

  it("accepts firing rows and uploads alert definitions", async () => {
    mockedRoutingListExists.mockResolvedValueOnce(true);
    mockedQuerySqlApi.mockResolvedValueOnce([{ route: "/api" }]);
    mockedUpsertAlertDefinitions.mockResolvedValueOnce({
      uploaded: 1,
      deactivated: 2,
    });
    const rawYaml = readFileSync(join(fixtureDir, "valid-alerts.yaml"), "utf8");

    const response = await callAlertsUpload({
      rawYaml,
      sourceUrl: "https://github.com/acme/repo/blob/main/alerts.yaml",
      git: {
        repo: "acme/repo",
        branch: "main",
        commitSha: "abc123",
        remote: "origin",
        path: "alerts.yaml",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      uploaded: 1,
      deactivated: 2,
      sourceUrl: "https://github.com/acme/repo/blob/main/alerts.yaml",
    });
    expect(mockedQuerySqlApi).toHaveBeenCalledOnce();
    expect(mockedUpsertAlertDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-42",
        rawYaml,
        sourceUrl: "https://github.com/acme/repo/blob/main/alerts.yaml",
        sourceRepo: "acme/repo",
        sourceBranch: "main",
        sourceCommitSha: "abc123",
        sourceRemote: "origin",
        sourcePath: "alerts.yaml",
        userId: "user-1",
        alerts: [
          expect.objectContaining({
            service: "api",
            name: "high-5xx-routes",
            routing: "admins",
          }),
        ],
      }),
    );
  });
});
