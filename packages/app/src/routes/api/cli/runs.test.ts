import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/runs-list", () => ({
  getRunsList: vi.fn(),
}));

vi.mock("@/data/watch", () => ({
  getWatchStatus: vi.fn(),
}));

vi.mock("./-auth", () => ({
  cliAuthMiddleware: {
    options: {},
  },
}));

import { getRunsList } from "@/data/runs-list/server";
import { getWatchStatus } from "@/data/watch";
import { Route } from "./runs";

const mockedGetRunsList = vi.mocked(getRunsList);
const mockedGetWatchStatus = vi.mocked(getWatchStatus);

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
    throw new Error("Missing GET handler for runs route.");
  }

  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/runs", () => {
  it("forwards limit and offset to runs list queries", async () => {
    mockedGetRunsList.mockResolvedValue({
      runs: [],
      totalCount: 0,
    });

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/runs?repo=everr-labs%2Feverr&limit=15&offset=30",
      ),
    });

    expect(response.status).toBe(200);
    expect(mockedGetRunsList).toHaveBeenCalledWith({
      data: {
        timeRange: {
          from: "now-7d",
          to: "now",
        },
        limit: 15,
        offset: 30,
        repo: "everr-labs/everr",
        branch: undefined,
        conclusion: undefined,
        workflowName: undefined,
        runId: undefined,
      },
    });
    expect(mockedGetWatchStatus).not.toHaveBeenCalled();
  });

  it("rejects the removed page query parameter", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/runs?page=2"),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "Invalid query parameters for runs listing. Check limit, offset, and filter values.",
    });
    expect(mockedGetRunsList).not.toHaveBeenCalled();
  });

  it("routes watch queries to the watch status loader", async () => {
    mockedGetWatchStatus.mockResolvedValue({
      repo: "everr-labs/everr",
      branch: "main",
      commit: "abc123",
      pipelineFound: true,
      activeRuns: [],
      completedRuns: [],
    });

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/runs?repo=everr-labs%2Feverr&branch=main&commit=abc123&watchMode=pipeline",
      ),
    });

    expect(response.status).toBe(200);
    expect(mockedGetWatchStatus).toHaveBeenCalledWith({
      data: {
        repo: "everr-labs/everr",
        branch: "main",
        commit: "abc123",
      },
    });
    expect(mockedGetRunsList).not.toHaveBeenCalled();
  });

  it("rejects the legacy waitMode query parameter", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/runs?waitMode=pipeline"),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "Invalid query parameters for runs listing. Check limit, offset, and filter values.",
    });
    expect(mockedGetWatchStatus).not.toHaveBeenCalled();
  });

  it("requires repo, branch, and commit for watch queries", async () => {
    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/runs?repo=everr-labs%2Feverr&watchMode=pipeline",
      ),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "Invalid query parameters for watch. Required: repo, branch, commit.",
    });
    expect(mockedGetWatchStatus).not.toHaveBeenCalled();
  });
});
