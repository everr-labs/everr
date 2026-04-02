import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("@/lib/accessTokenAuthMiddleware", () => ({
  accessTokenAuthMiddleware: {
    options: {},
  },
}));

import { query } from "@/lib/clickhouse";
import { Route } from "./notification";

const mockedQuery = vi.mocked(query);

type GetHandler = (args: {
  request: Request;
  context: {
    session: { userId: string; tenantId: number };
    clickhouse: { query: typeof mockedQuery };
  };
}) => Promise<Response>;

function getHandler(): GetHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { GET?: GetHandler } };
  };
  const handler = routeOptions.server?.handlers?.GET;
  if (!handler) throw new Error("Missing GET handler for notification route.");
  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/notification", () => {
  it("returns 400 when traceId is missing", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/notification"),
      context: {
        session: { userId: "user_1", tenantId: 42 },
        clickhouse: { query: mockedQuery },
      },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid query parameters. Required: traceId.",
    });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("returns the failure notification for the given traceId", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        traceId: "trace-abc",
        runId: "run-abc",
        repo: "org/repo",
        branch: "main",
        workflowName: "CI",
        failureTime: "2026-04-02T10:00:00Z",
      },
    ]);
    mockedQuery.mockResolvedValueOnce([]);
    mockedQuery.mockResolvedValueOnce([]);

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/notification?traceId=trace-abc",
      ),
      context: {
        session: { userId: "user_1", tenantId: 42 },
        clickhouse: { query: mockedQuery },
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      traceId: "trace-abc",
      repo: "org/repo",
      branch: "main",
      workflowName: "CI",
    });
  });

  it("returns empty array when no failure found for traceId", async () => {
    mockedQuery.mockResolvedValueOnce([]);

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/notification?traceId=trace-xyz",
      ),
      context: {
        session: { userId: "user_1", tenantId: 42 },
        clickhouse: { query: mockedQuery },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});
