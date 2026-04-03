import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { pool } from "@/db/client";
import { Route } from "./notification";

const mockedQuery = vi.mocked(pool.query);

type GetHandler = (args: {
  request: Request;
  context: {
    session: { userId: string; tenantId: number };
    clickhouse: { query: ReturnType<typeof vi.fn> };
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

const context = {
  session: { userId: "user_1", tenantId: 42 },
  clickhouse: { query: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/notification", () => {
  it("returns 400 when traceId is missing", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/notification"),
      context,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid query parameters. Required: traceId.",
    });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("returns failure notification for the given traceId", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            traceId: "trace-abc",
            repo: "org/repo",
            branch: "main",
            workflowName: "CI",
            failureTime: new Date("2026-04-02T10:00:00Z"),
          },
        ],
      } as Awaited<ReturnType<typeof mockedQuery>>)
      .mockResolvedValueOnce({ rows: [] } as Awaited<
        ReturnType<typeof mockedQuery>
      >);

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/notification?traceId=trace-abc",
      ),
      context,
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      traceId: "trace-abc",
      repo: "org/repo",
      branch: "main",
      workflowName: "CI",
      failedAt: "2026-04-02T10:00:00.000Z",
    });
  });

  it("returns empty array when no failure found for traceId", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as Awaited<
      ReturnType<typeof mockedQuery>
    >);

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/notification?traceId=trace-xyz",
      ),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});
