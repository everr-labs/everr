import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

vi.mock("@/lib/workos", () => ({
  getWorkOS: vi.fn(),
}));

vi.mock("./-auth", () => ({
  cliAuthMiddleware: {
    options: {},
  },
}));

import { query } from "@/lib/clickhouse";
import { getWorkOS } from "@/lib/workos";
import { Route } from "./tray-status";

const mockedQuery = vi.mocked(query);
const mockedGetWorkOS = vi.mocked(getWorkOS);

type GetHandler = (args: {
  request: Request;
  context: {
    auth: {
      userId: string;
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
    throw new Error("Missing GET handler for tray status route.");
  }

  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetWorkOS.mockReturnValue({
    userManagement: {
      getUser: vi.fn().mockResolvedValue({
        emailVerified: true,
        email: "dev@example.com",
      }),
    },
  } as never);
});

describe("/api/cli/tray-status", () => {
  it("returns a zeroed tray status when the user email is not verified", async () => {
    mockedGetWorkOS.mockReturnValue({
      userManagement: {
        getUser: vi.fn().mockResolvedValue({
          emailVerified: false,
          email: "dev@example.com",
        }),
      },
    } as never);

    const handler = getHandler();
    const response = await handler({
      request: new Request("http://localhost/api/cli/tray-status"),
      context: {
        auth: {
          userId: "user_1",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      verified_match: false,
      unresolved_failures: [],
      failed_runs_dashboard_url:
        "http://localhost/dashboard/runs?conclusion=failure&from=now-30m&to=now",
      auto_fix_prompt: "",
    });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("returns the verified unresolved failures", async () => {
    mockedQuery.mockResolvedValueOnce([]);

    const handler = getHandler();
    const response = await handler({
      request: new Request("http://localhost/api/cli/tray-status"),
      context: {
        auth: {
          userId: "user_1",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      verified_match: true,
      unresolved_failures: [],
      auto_fix_prompt: "",
    });
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("FROM traces");
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "lowerUTF8(ResourceAttributes['vcs.ref.head.revision.author.email'])",
    );
  });

  it("filters out failures resolved by a later successful run on the same branch", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        traceId: "trace-1",
        runId: "run-1",
        repo: "everr-labs/everr",
        branch: "main",
        workflowName: "CI",
        failureTime: "2026-03-08T10:00:00Z",
      },
    ]);
    mockedQuery.mockResolvedValueOnce([]);
    mockedQuery.mockResolvedValueOnce([]);

    const handler = getHandler();
    const response = await handler({
      request: new Request("http://localhost/api/cli/tray-status"),
      context: {
        auth: {
          userId: "user_1",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      unresolved_failures: [],
      auto_fix_prompt: "",
    });
  });

  it("filters out failures resolved by a later in-flight run on the same branch", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        traceId: "trace-1",
        runId: "run-1",
        repo: "everr-labs/everr",
        branch: "main",
        workflowName: "CI",
        failureTime: "2026-03-08T10:00:00Z",
      },
    ]);
    mockedQuery.mockResolvedValueOnce([]);
    mockedQuery.mockResolvedValueOnce([
      {
        runId: "run-3",
        repo: "everr-labs/everr",
        branch: "main",
        startedAt: "2026-03-08T10:06:00Z",
      },
    ]);

    const handler = getHandler();
    const response = await handler({
      request: new Request("http://localhost/api/cli/tray-status"),
      context: {
        auth: {
          userId: "user_1",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      unresolved_failures: [],
      auto_fix_prompt: "",
    });
  });

  it("keeps earlier failures unresolved when only later failures exist on the same branch", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        traceId: "trace-1",
        runId: "run-1",
        repo: "everr-labs/everr",
        branch: "main",
        workflowName: "CI",
        failureTime: "2026-03-08T10:00:00Z",
      },
      {
        traceId: "trace-2",
        runId: "run-2",
        repo: "everr-labs/everr",
        branch: "main",
        workflowName: "CI",
        failureTime: "2026-03-08T10:05:00Z",
      },
    ]);
    mockedQuery.mockResolvedValueOnce([]);
    mockedQuery.mockResolvedValueOnce([]);
    mockedQuery.mockResolvedValueOnce([]);

    const handler = getHandler();
    const response = await handler({
      request: new Request("http://localhost/api/cli/tray-status"),
      context: {
        auth: {
          userId: "user_1",
        },
      },
    });

    const payload = await response.json();
    expect(payload.unresolved_failures).toHaveLength(2);
    expect(
      payload.unresolved_failures.map(
        (failure: { trace_id: string }) => failure.trace_id,
      ),
    ).toEqual(["trace-1", "trace-2"]);
  });

  it("returns the failed-runs dashboard URL and a prefilled auto-fix prompt", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        traceId: "trace-123",
        runId: "run-123",
        repo: "everr-labs/everr",
        branch: "feature/granola",
        workflowName: "CI",
        failureTime: "2026-03-08T10:00:00Z",
      },
    ]);
    mockedQuery.mockResolvedValueOnce([]);
    mockedQuery.mockResolvedValueOnce([]);
    mockedQuery.mockResolvedValueOnce([
      {
        trace_id: "trace-123",
        jobId: "job-1",
        jobName: "test",
        stepName: "Run suite",
        stepNumber: "3",
      },
    ]);

    const handler = getHandler();
    const response = await handler({
      request: new Request("http://localhost/api/cli/tray-status"),
      context: {
        auth: {
          userId: "user_1",
        },
      },
    });

    const payload = await response.json();
    expect(payload.failed_runs_dashboard_url).toBe(
      "http://localhost/dashboard/runs?conclusion=failure&from=now-30m&to=now",
    );
    expect(payload.unresolved_failures[0]).toMatchObject({
      trace_id: "trace-123",
      details_url:
        "http://localhost/dashboard/runs/trace-123/jobs/job-1/steps/3",
      job_name: "test",
      step_number: "3",
      step_name: "Run suite",
    });
    expect(payload.auto_fix_prompt).toContain("everr status");
    expect(payload.auto_fix_prompt).toContain("trace-123");
    expect(payload.auto_fix_prompt).toContain("feature/granola");
    expect(payload.auto_fix_prompt).toContain(
      "http://localhost/dashboard/runs/trace-123/jobs/job-1/steps/3",
    );
  });
});
