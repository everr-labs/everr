import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/data/runs-list", () => ({
  getRunsList: vi.fn(),
  RunLifecycleStatusSchema: z.enum(["queued", "in_progress", "completed"]),
}));

vi.mock("@/data/wait-pipeline", () => ({
  getWaitPipelineStatus: vi.fn(),
}));

vi.mock("./-auth", () => ({
  cliAuthMiddleware: {
    options: {},
  },
}));

import { getRunsList } from "@/data/runs-list";
import { getWaitPipelineStatus } from "@/data/wait-pipeline";
import { Route } from "./runs";

const mockedGetRunsList = vi.mocked(getRunsList);
const mockedGetWaitPipelineStatus = vi.mocked(getWaitPipelineStatus);

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
        status: undefined,
        conclusion: undefined,
        workflowName: undefined,
        runId: undefined,
      },
    });
    expect(mockedGetWaitPipelineStatus).not.toHaveBeenCalled();
  });

  it("forwards status to runs list queries", async () => {
    mockedGetRunsList.mockResolvedValue({
      runs: [],
      totalCount: 0,
    });

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/runs?status=in_progress"),
    });

    expect(response.status).toBe(200);
    expect(mockedGetRunsList).toHaveBeenCalledWith({
      data: {
        timeRange: {
          from: "now-7d",
          to: "now",
        },
        limit: undefined,
        offset: undefined,
        repo: undefined,
        branch: undefined,
        status: "in_progress",
        conclusion: undefined,
        workflowName: undefined,
        runId: undefined,
      },
    });
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

  it("rejects invalid status filters", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/runs?status=running"),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "Invalid query parameters for runs listing. Check limit, offset, and filter values.",
    });
    expect(mockedGetRunsList).not.toHaveBeenCalled();
  });
});
