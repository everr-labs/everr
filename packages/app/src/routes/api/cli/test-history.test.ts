import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/flaky-tests/server", () => ({
  getTestHistory: vi.fn(),
}));

vi.mock("@/lib/accessTokenAuthMiddleware", () => ({
  accessTokenAuthMiddleware: {
    options: {},
  },
}));

import { getTestHistory } from "@/data/flaky-tests/server";
import { Route } from "./test-history";

const mockedGetTestHistory = vi.mocked(getTestHistory);

type GetHandler = (args: { request: Request }) => Promise<Response>;

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
    throw new Error("Missing GET handler for test-history route.");
  }

  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/test-history", () => {
  it("forwards explicit limit and offset to the data query", async () => {
    mockedGetTestHistory.mockResolvedValue([
      {
        traceId: "trace-1",
        runId: "run-1",
        runAttempt: 1,
        headSha: "abc123",
        headBranch: "main",
        testResult: "pass",
        testDuration: 1.2,
        runnerName: "ubuntu-latest",
        workflowName: "CI",
        jobName: "test",
        timestamp: "2026-03-09 12:00:00",
      },
    ]);

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/test-history?repo=everr-labs%2Feverr&testModule=suite&testName=works&limit=25&offset=50",
      ),
    });

    expect(response.status).toBe(200);
    expect(mockedGetTestHistory).toHaveBeenCalledWith({
      data: {
        repo: "everr-labs/everr",
        testFullName: undefined,
        testModule: "suite",
        testName: "works",
        limit: 25,
        offset: 50,
        timeRange: {
          from: "now-7d",
          to: "now",
        },
      },
    });
  });
});
