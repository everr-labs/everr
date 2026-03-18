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

import { pool } from "@/db/client";
import { query } from "@/lib/clickhouse";
import { Route } from "./failures";

const mockedQuery = vi.mocked(query);
const mockedPoolQuery = vi.mocked(pool.query);

type GetHandler = (args: {
  request: Request;
  context: {
    session: {
      userId: string;
      tenantId: number;
    };
    clickhouse: {
      query: typeof mockedQuery;
    };
  };
}) => Promise<Response>;

function getHandler(): GetHandler {
  const routeOptions = Route.options as unknown as {
    server?: {
      handlers?: {
        GET?: GetHandler;
      };
    };
  };

  const handler = routeOptions.server?.handlers?.GET;
  if (!handler) {
    throw new Error("Missing GET handler for notifier failures route.");
  }

  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/notifier/failures", () => {
  it("returns a validation error when gitEmail is missing", async () => {
    const handler = getHandler();
    const response = await handler({
      request: new Request("http://localhost/api/cli/notifier/failures"),
      context: {
        session: {
          userId: "user_1",
          tenantId: 42,
        },
        clickhouse: {
          query: mockedQuery,
        },
      },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "Invalid query parameters. Required: gitEmail. Optional: repo, branch.",
    });
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(mockedPoolQuery).not.toHaveBeenCalled();
  });

  it("returns a direct run detail URL", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        traceId: "trace-123",
        runId: "run-123",
        repo: "everr-labs/everr",
        branch: "main",
        workflowName: "CI",
        failureTime: "2026-03-07T13:32:00Z",
      },
    ]);
    mockedQuery.mockResolvedValueOnce([]);
    mockedQuery.mockResolvedValueOnce([]);

    const handler = getHandler();
    const response = await handler({
      request: new Request(
        "http://localhost/api/cli/notifier/failures?gitEmail=dev@example.com",
      ),
      context: {
        session: {
          userId: "user_1",
          tenantId: 42,
        },
        clickhouse: {
          query: mockedQuery,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        dedupeKey: "trace-123:2026-03-07T13:32:00Z",
        traceId: "trace-123",
        repo: "everr-labs/everr",
        branch: "main",
        workflowName: "CI",
        failedAt: "2026-03-07T13:32:00Z",
        detailsUrl: "http://localhost/runs/trace-123",
      },
    ]);
  });

  it("passes repo and branch filters into the query", async () => {
    mockedQuery.mockResolvedValueOnce([]);

    const handler = getHandler();
    const response = await handler({
      request: new Request(
        "http://localhost/api/cli/notifier/failures?gitEmail=dev@example.com&repo=everr-labs/everr&branch=feature%2Fgranola",
      ),
      context: {
        session: {
          userId: "user_1",
          tenantId: 42,
        },
        clickhouse: {
          query: mockedQuery,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual({
      gitEmail: "dev@example.com",
      repo: "everr-labs/everr",
      branch: "feature/granola",
    });
  });

  it("attaches the first failing step deterministically", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        traceId: "trace-123",
        runId: "run-123",
        repo: "everr-labs/everr",
        branch: "main",
        workflowName: "CI",
        failureTime: "2026-03-07T13:32:00Z",
      },
    ]);
    mockedQuery.mockResolvedValueOnce([
      {
        trace_id: "trace-123",
        jobId: "job-2",
      },
      {
        trace_id: "trace-123",
        jobId: "job-1",
      },
    ]);
    mockedQuery.mockResolvedValueOnce([
      {
        trace_id: "trace-123",
        jobId: "job-2",
        jobName: "lint",
        stepName: "Run linter",
        stepNumber: "1",
        conclusion: "failure",
      },
      {
        trace_id: "trace-123",
        jobId: "job-1",
        jobName: "test",
        stepName: "Boot services",
        stepNumber: "2",
        conclusion: "success",
      },
      {
        trace_id: "trace-123",
        jobId: "job-1",
        jobName: "test",
        stepName: "Install dependencies",
        stepNumber: "1",
        conclusion: "failure",
      },
    ]);

    const handler = getHandler();
    const response = await handler({
      request: new Request(
        "http://localhost/api/cli/notifier/failures?gitEmail=dev@example.com",
      ),
      context: {
        session: {
          userId: "user_1",
          tenantId: 42,
        },
        clickhouse: {
          query: mockedQuery,
        },
      },
    });

    const payload = await response.json();
    expect(payload[0]).toMatchObject({
      detailsUrl: "http://localhost/runs/trace-123/jobs/job-1/steps/1",
      jobName: "test",
      stepNumber: "1",
      stepName: "Install dependencies",
    });
    expect(payload[0]).not.toHaveProperty("autoFixPrompt");
  });

  it("falls back to the latest step in a failed job when no explicit failing step exists", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        traceId: "trace-123",
        runId: "run-123",
        repo: "everr-labs/everr",
        branch: "main",
        workflowName: "CI",
        failureTime: "2026-03-07T13:32:00Z",
      },
    ]);
    mockedQuery.mockResolvedValueOnce([
      {
        trace_id: "trace-123",
        jobId: "job-1",
      },
    ]);
    mockedQuery.mockResolvedValueOnce([
      {
        trace_id: "trace-123",
        jobId: "job-1",
        jobName: "test",
        stepName: "Install dependencies",
        stepNumber: "1",
        conclusion: "success",
      },
      {
        trace_id: "trace-123",
        jobId: "job-1",
        jobName: "test",
        stepName: "Run suite",
        stepNumber: "3",
        conclusion: "",
      },
    ]);

    const handler = getHandler();
    const response = await handler({
      request: new Request(
        "http://localhost/api/cli/notifier/failures?gitEmail=dev@example.com",
      ),
      context: {
        session: {
          userId: "user_1",
          tenantId: 42,
        },
        clickhouse: {
          query: mockedQuery,
        },
      },
    });

    const payload = await response.json();
    expect(payload[0].jobName).toBe("test");
    expect(payload[0].stepNumber).toBe("3");
    expect(payload[0].stepName).toBe("Run suite");
    expect(payload[0]).not.toHaveProperty("autoFixPrompt");
  });
});
