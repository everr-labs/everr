import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("#app/data/branch-status.ts", () => ({
  getBranchStatus: vi.fn(),
}));

import { getBranchStatus } from "#app/data/branch-status.ts";
import { cliSessionContext, getRouteHandler } from "../-test-utils";
import { Route } from "./status";

const mockedGetBranchStatus = vi.mocked(getBranchStatus);

type GetHandler = (args: {
  request: Request;
  context: {
    session: {
      session: {
        activeOrganizationId: string;
      };
    };
  };
}) => Promise<Response>;

function getHandler(): GetHandler {
  return getRouteHandler<GetHandler>(Route, "GET", "status route");
}

function callStatus(query: string) {
  return getHandler()({
    request: new Request(`http://localhost/api/cli/runs/status?${query}`),
    context: cliSessionContext(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/runs/status", () => {
  it("returns a pending status response", async () => {
    mockedGetBranchStatus.mockResolvedValue({
      repo: "everr-labs/everr",
      branch: "main",
      commit: "abc123",
      state: "pending",
      active: [],
      completed: [],
    });

    const response = await callStatus("repo=everr-labs%2Feverr&branch=main&commit=abc123");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      repo: "everr-labs/everr",
      branch: "main",
      commit: "abc123",
      state: "pending",
      active: [],
      completed: [],
    });
  });

  it("passes attempt through to getBranchStatus when provided", async () => {
    mockedGetBranchStatus.mockResolvedValue({
      repo: "everr-labs/everr",
      branch: "main",
      commit: "abc123",
      state: "pending",
      active: [],
      completed: [],
    });

    const response = await callStatus(
      "repo=everr-labs%2Feverr&branch=main&commit=abc123&attempt=3",
    );

    expect(response.status).toBe(200);
    expect(mockedGetBranchStatus).toHaveBeenCalledWith({
      tenantId: "org-42",
      repo: "everr-labs/everr",
      branch: "main",
      commit: "abc123",
      attempt: 3,
    });
  });

  it("passes runId through to getBranchStatus without requiring commit", async () => {
    mockedGetBranchStatus.mockResolvedValue({
      repo: "everr-labs/everr",
      branch: null,
      commit: "",
      state: "pending",
      active: [],
      completed: [],
    });

    const response = await callStatus("repo=everr-labs%2Feverr&runId=4242");

    expect(response.status).toBe(200);
    expect(mockedGetBranchStatus).toHaveBeenCalledWith({
      tenantId: "org-42",
      repo: "everr-labs/everr",
      branch: undefined,
      commit: undefined,
      attempt: undefined,
      runId: "4242",
    });
  });

  it("requires repo and either commit or runId", async () => {
    const response = await callStatus("repo=everr-labs%2Feverr");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid query parameters for status. Required: repo and either commit or runId.",
    });
    expect(mockedGetBranchStatus).not.toHaveBeenCalled();
  });
});
