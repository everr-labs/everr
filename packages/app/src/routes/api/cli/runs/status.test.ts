import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/branch-status", () => ({
  getBranchStatus: vi.fn(),
}));

vi.mock("@/lib/accessTokenAuthMiddleware", () => ({
  accessTokenAuthMiddleware: {
    options: {},
  },
}));

import { getBranchStatus } from "@/data/branch-status";
import { Route } from "./status";

const mockedGetBranchStatus = vi.mocked(getBranchStatus);

type GetHandler = (args: {
  request: Request;
  context: {
    session: {
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
    throw new Error("Missing GET handler for status route.");
  }

  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/runs/status", () => {
  it("returns a pending status response", async () => {
    mockedGetBranchStatus.mockResolvedValue({
      state: "pending",
      active: [],
      completed: [],
    });

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/runs/status?repo=everr-labs%2Feverr&branch=main&commit=abc123",
      ),
      context: {
        session: {
          tenantId: 42,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      state: "pending",
      active: [],
      completed: [],
    });
  });

  it("returns a running status response", async () => {
    mockedGetBranchStatus.mockResolvedValue({
      state: "running",
      active: [
        {
          traceId: "trace-42",
          runId: "42",
          workflowName: "CI",
          conclusion: null,
          startedAt: "2026-03-06T10:00:00.000Z",
          durationSeconds: null,
          activeJobs: ["test"],
          failingJobs: [],
        },
      ],
      completed: [],
    });

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/runs/status?repo=everr-labs%2Feverr&branch=main&commit=abc123",
      ),
      context: {
        session: {
          tenantId: 42,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      state: "running",
      active: [
        {
          runId: "42",
          workflowName: "CI",
        },
      ],
      completed: [],
    });
  });

  it("returns a completed status response", async () => {
    mockedGetBranchStatus.mockResolvedValue({
      state: "completed",
      active: [],
      completed: [
        {
          traceId: "trace-88",
          runId: "88",
          workflowName: "CI",
          conclusion: "success",
          startedAt: "2026-03-06T10:00:00.000Z",
          durationSeconds: 61,
          activeJobs: [],
          failingJobs: [],
        },
      ],
    });

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/runs/status?repo=everr-labs%2Feverr&branch=main&commit=abc123",
      ),
      context: {
        session: {
          tenantId: 42,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      state: "completed",
      active: [],
      completed: [
        {
          runId: "88",
          workflowName: "CI",
          conclusion: "success",
        },
      ],
    });
  });

  it("passes attempt through to getBranchStatus when provided", async () => {
    mockedGetBranchStatus.mockResolvedValue({
      state: "pending",
      active: [],
      completed: [],
    });

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/runs/status?repo=everr-labs%2Feverr&branch=main&commit=abc123&attempt=3",
      ),
      context: {
        session: {
          tenantId: 42,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(mockedGetBranchStatus).toHaveBeenCalledWith({
      tenantId: 42,
      repo: "everr-labs/everr",
      branch: "main",
      commit: "abc123",
      attempt: 3,
    });
  });

  it("requires repo, branch, and commit", async () => {
    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/runs/status?repo=everr-labs%2Feverr",
      ),
      context: {
        session: {
          tenantId: 42,
        },
      },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "Invalid query parameters for status. Required: repo, branch, commit.",
    });
    expect(mockedGetBranchStatus).not.toHaveBeenCalled();
  });
});
