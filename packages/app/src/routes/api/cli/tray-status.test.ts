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

vi.mock("./-auth", () => ({
  cliAuthMiddleware: {
    options: {},
  },
}));

import { pool } from "@/db/client";
import { query } from "@/lib/clickhouse";
import { workOS } from "@/lib/workos";
import { Route } from "./tray-status";

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
    throw new Error("Missing GET handler for tray status route.");
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

describe("/api/cli/tray-status", () => {
  it("returns a zeroed tray status when the user email is not verified", async () => {
    mockedGetUser.mockResolvedValue({
      emailVerified: false,
      email: "dev@example.com",
    } as Awaited<ReturnType<typeof mockedGetUser>>);

    const handler = getHandler();
    const response = await handler({
      request: new Request("http://localhost/api/cli/tray-status"),
      context: {
        auth: {
          userId: "user_1",
          tenantId: 42,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      failures: [],
      dashboardUrl: null,
      autoFixPrompt: null,
    });
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(mockedPoolQuery).not.toHaveBeenCalled();
  });

  it("returns the verified unresolved failures", async () => {
    mockedQuery.mockResolvedValueOnce([]);

    const handler = getHandler();
    const response = await handler({
      request: new Request("http://localhost/api/cli/tray-status"),
      context: {
        auth: {
          userId: "user_1",
          tenantId: 42,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      failures: [],
      dashboardUrl:
        "http://localhost/runs?conclusion=failure&from=now-30m&to=now",
      autoFixPrompt: null,
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
    mockedQuery.mockResolvedValueOnce([
      {
        runId: "run-2",
        repo: "everr-labs/everr",
        branch: "main",
        startedAt: "2026-03-08T10:05:00Z",
      },
    ]);
    mockedPoolQuery.mockResolvedValueOnce({
      rows: [],
    } as Awaited<ReturnType<typeof mockedPoolQuery>>);

    const handler = getHandler();
    const response = await handler({
      request: new Request("http://localhost/api/cli/tray-status"),
      context: {
        auth: {
          userId: "user_1",
          tenantId: 42,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      failures: [],
      autoFixPrompt: null,
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
    mockedPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          runId: "run-3",
          repo: "everr-labs/everr",
          branch: "main",
          startedAt: "2026-03-08T10:06:00Z",
        },
      ],
    } as Awaited<ReturnType<typeof mockedPoolQuery>>);

    const handler = getHandler();
    const response = await handler({
      request: new Request("http://localhost/api/cli/tray-status"),
      context: {
        auth: {
          userId: "user_1",
          tenantId: 42,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      failures: [],
      autoFixPrompt: null,
    });
  });

  it("filters out failures when Postgres returns the active run timestamp as a Date", async () => {
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
    mockedPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          runId: "run-3",
          repo: "everr-labs/everr",
          branch: "main",
          startedAt: new Date("2026-03-08T10:06:00Z"),
        },
      ],
    } as Awaited<ReturnType<typeof mockedPoolQuery>>);

    const handler = getHandler();
    const response = await handler({
      request: new Request("http://localhost/api/cli/tray-status"),
      context: {
        auth: {
          userId: "user_1",
          tenantId: 42,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      failures: [],
      autoFixPrompt: null,
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
    mockedPoolQuery.mockResolvedValueOnce({
      rows: [],
    } as Awaited<ReturnType<typeof mockedPoolQuery>>);

    const handler = getHandler();
    const response = await handler({
      request: new Request("http://localhost/api/cli/tray-status"),
      context: {
        auth: {
          userId: "user_1",
          tenantId: 42,
        },
      },
    });

    const payload = await response.json();
    expect(payload.failures).toHaveLength(2);
    expect(
      payload.failures.map((failure: { traceId: string }) => failure.traceId),
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
    mockedPoolQuery.mockResolvedValueOnce({
      rows: [],
    } as Awaited<ReturnType<typeof mockedPoolQuery>>);
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
        stepName: "Run suite",
        stepNumber: "3",
        conclusion: "failure",
      },
    ]);

    const handler = getHandler();
    const response = await handler({
      request: new Request("http://localhost/api/cli/tray-status"),
      context: {
        auth: {
          userId: "user_1",
          tenantId: 42,
        },
      },
    });

    const payload = await response.json();
    expect(payload.dashboardUrl).toBe(
      "http://localhost/runs?conclusion=failure&from=now-30m&to=now",
    );
    expect(payload.failures[0]).toMatchObject({
      traceId: "trace-123",
      detailsUrl: "http://localhost/runs/trace-123/jobs/job-1/steps/3",
      jobName: "test",
      stepNumber: "3",
      stepName: "Run suite",
    });
    expect(payload.autoFixPrompt).toContain(
      "Start by pulling logs with the exact `everr runs logs` command listed for each failure below.",
    );
    expect(payload.autoFixPrompt).toContain(
      'everr runs logs --trace-id trace-123 --job-name "test" --step-number 3',
    );
    expect(payload.autoFixPrompt).toContain("trace-123");
    expect(payload.autoFixPrompt).toContain("feature/granola");
    expect(payload.autoFixPrompt).not.toContain("http://localhost");
  });
});
