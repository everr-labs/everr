import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/runs-list", () => ({
  getRunsList: vi.fn(),
}));

vi.mock("./-auth", () => ({
  cliAuthMiddleware: {
    options: {},
  },
}));

import { getRunsList } from "@/data/runs-list";
import { Route } from "./status";

const mockedGetRunsList = vi.mocked(getRunsList);

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
    throw new Error("Missing GET handler for status route.");
  }

  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/status", () => {
  it("returns no_data when no branch runs are available", async () => {
    mockedGetRunsList.mockResolvedValue({
      runs: [],
      totalCount: 0,
    });

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/status?repo=everr-labs%2Feverr&branch=feature%2Fempty",
      ),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "no_data",
      repo: "everr-labs/everr",
      branch: "feature/empty",
      message: "No branch runs found for the selected time range.",
    });
    expect(mockedGetRunsList).toHaveBeenCalledWith({
      data: {
        timeRange: {
          from: "now-7d",
          to: "now",
        },
        limit: 10,
        repo: "everr-labs/everr",
        branch: "feature/empty",
        status: "completed",
      },
    });
  });

  it("returns a compact ok payload without removed fields", async () => {
    mockedGetRunsList.mockResolvedValue({
      runs: [
        {
          traceId: "trace-1",
          runId: "run-1",
          runAttempt: 1,
          workflowName: "CI",
          repo: "everr-labs/everr",
          branch: "main",
          status: "completed",
          conclusion: "success",
          duration: 12340,
          timestamp: "2026-03-10T14:00:00Z",
          sender: "octocat",
          headSha: "abc123",
          jobCount: 4,
        },
      ],
      totalCount: 1,
    });

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/status?repo=everr-labs%2Feverr&branch=main&from=now-1h&to=now",
      ),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      status: "ok",
      repo: "everr-labs/everr",
      branch: "main",
      latestPipeline: {
        traceId: "trace-1",
        runId: "run-1",
        workflowName: "CI",
        conclusion: "success",
        durationMs: 12340,
        timestamp: "2026-03-10T14:00:00Z",
      },
      failures: [],
      message:
        "Everything looks good. Latest pipeline duration is 12.34 seconds.",
    });
    expect(payload).not.toHaveProperty("mainBranch");
    expect(payload).not.toHaveProperty("inspectedRuns");
    expect(payload).not.toHaveProperty("failingPipelines");
    expect(payload).not.toHaveProperty("slowdown");
  });

  it("returns failures with failedStep and logsArgs when step metadata exists", async () => {
    mockedGetRunsList.mockResolvedValue({
      runs: [
        {
          traceId: "trace-2",
          runId: "run-2",
          runAttempt: 1,
          workflowName: "Build & Test App",
          repo: "everr-labs/everr",
          branch: "feature/fail",
          status: "completed",
          conclusion: "failure",
          duration: 98000,
          timestamp: "2026-03-10T14:10:00Z",
          sender: "octocat",
          headSha: "def456",
          jobCount: 3,
          failingSteps: [
            {
              jobName: "CI",
              jobId: "job-1",
              stepNumber: 9,
              stepName: "Test",
            },
          ],
        },
      ],
      totalCount: 1,
    });

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/status?repo=everr-labs%2Feverr&branch=feature%2Ffail",
      ),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "attention",
      repo: "everr-labs/everr",
      branch: "feature/fail",
      latestPipeline: {
        traceId: "trace-2",
        runId: "run-2",
        workflowName: "Build & Test App",
        conclusion: "failure",
        durationMs: 98000,
        timestamp: "2026-03-10T14:10:00Z",
      },
      failures: [
        {
          traceId: "trace-2",
          runId: "run-2",
          workflowName: "Build & Test App",
          conclusion: "failure",
          durationMs: 98000,
          timestamp: "2026-03-10T14:10:00Z",
          failedStep: {
            jobName: "CI",
            stepNumber: "9",
            stepName: "Test",
          },
          logsArgs: {
            jobName: "CI",
            stepNumber: "9",
          },
        },
      ],
      message: "Found 1 failing pipeline(s) in recent branch runs.",
    });
  });

  it("keeps failure items compact when no step metadata exists", async () => {
    mockedGetRunsList.mockResolvedValue({
      runs: [
        {
          traceId: "trace-3",
          runId: "run-3",
          runAttempt: 1,
          workflowName: "CI",
          repo: "everr-labs/everr",
          branch: "feature/no-step",
          status: "completed",
          conclusion: "failed",
          duration: 42000,
          timestamp: "2026-03-10T14:20:00Z",
          sender: "octocat",
          headSha: "ghi789",
          jobCount: 2,
          failingSteps: [],
        },
      ],
      totalCount: 1,
    });

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/status?repo=everr-labs%2Feverr&branch=feature%2Fno-step",
      ),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.failures).toEqual([
      {
        traceId: "trace-3",
        runId: "run-3",
        workflowName: "CI",
        conclusion: "failed",
        durationMs: 42000,
        timestamp: "2026-03-10T14:20:00Z",
      },
    ]);
  });

  it("rejects removed query parameters", async () => {
    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/status?repo=everr-labs%2Feverr&branch=main&mainBranch=main",
      ),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "Invalid query parameters. Required: repo, branch. Optional: from, to.",
    });
    expect(mockedGetRunsList).not.toHaveBeenCalled();
  });

  it("rejects unexpected query parameters", async () => {
    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/status?repo=everr-labs%2Feverr&branch=main&foo=bar",
      ),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "Invalid query parameters. Required: repo, branch. Optional: from, to.",
    });
    expect(mockedGetRunsList).not.toHaveBeenCalled();
  });
});
