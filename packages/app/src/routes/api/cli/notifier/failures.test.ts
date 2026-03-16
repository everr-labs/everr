import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("@/lib/workos", () => ({
  workOS: {
    userManagement: {
      getUser: vi.fn(),
    },
    organizations: {
      getOrganization: vi.fn(),
    },
  },
}));

vi.mock("../-auth", () => ({
  cliAuthMiddleware: {
    options: {},
  },
}));

import { pool } from "@/db/client";
import { query } from "@/lib/clickhouse";
import { workOS } from "@/lib/workos";
import { Route } from "./failures";

const mockedQuery = vi.mocked(query);
const mockedPoolQuery = vi.mocked(pool.query);
const mockedGetUser = vi.mocked(workOS.userManagement.getUser);

type GetHandler = (args: {
  request: Request;
  context: {
    auth: {
      userId: string;
      tenantId: number;
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
  mockedGetUser.mockResolvedValue({
    emailVerified: true,
    email: "dev@example.com",
  } as Awaited<ReturnType<typeof mockedGetUser>>);
});

describe("/api/cli/notifier/failures", () => {
  it("returns no failures when the verified email does not match", async () => {
    mockedGetUser.mockResolvedValue({
      emailVerified: false,
      email: "dev@example.com",
    } as Awaited<ReturnType<typeof mockedGetUser>>);

    const handler = getHandler();
    const response = await handler({
      request: new Request(
        "http://localhost/api/cli/notifier/failures?gitEmail=dev@example.com",
      ),
      context: {
        auth: {
          userId: "user_1",
          tenantId: 42,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
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
        auth: {
          userId: "user_1",
          tenantId: 42,
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
        autoFixPrompt: expect.stringContaining("trace-123"),
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
        auth: {
          userId: "user_1",
          tenantId: 42,
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
        auth: {
          userId: "user_1",
          tenantId: 42,
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
    expect(payload[0].autoFixPrompt).toContain("trace-123");
    expect(payload[0].autoFixPrompt).toContain(
      'everr runs logs --trace-id trace-123 --job-name "test" --step-number 1',
    );
    expect(payload[0].autoFixPrompt).not.toContain("http://localhost");
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
        auth: {
          userId: "user_1",
          tenantId: 42,
        },
      },
    });

    const payload = await response.json();
    expect(payload[0].jobName).toBe("test");
    expect(payload[0].stepNumber).toBe("3");
    expect(payload[0].stepName).toBe("Run suite");
    expect(payload[0].autoFixPrompt).toContain("trace-123");
    expect(payload[0].autoFixPrompt).toContain(
      'everr runs logs --trace-id trace-123 --job-name "test" --step-number 3',
    );
  });
});
