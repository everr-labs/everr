import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/grep", () => ({
  getGrepMatches: vi.fn(),
  getGrepTimeRangeValidationError: vi.fn(() => null),
}));

vi.mock("./-auth", () => ({
  cliAuthMiddleware: {
    options: {},
  },
}));

import { getGrepMatches, getGrepTimeRangeValidationError } from "@/data/grep";
import { Route } from "./grep";

const mockedGetGrepMatches = vi.mocked(getGrepMatches);
const mockedGetGrepTimeRangeValidationError = vi.mocked(
  getGrepTimeRangeValidationError,
);

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
    throw new Error("Missing GET handler for grep route.");
  }

  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetGrepTimeRangeValidationError.mockReturnValue(null);
});

describe("/api/cli/grep", () => {
  it("returns grep search results for a valid request", async () => {
    mockedGetGrepMatches.mockResolvedValue({
      repo: "everr-labs/everr",
      pattern: "panic",
      jobName: "integration",
      stepNumber: "5",
      branch: null,
      excludedBranch: "feature/current-issue",
      timeRange: {
        from: "now-30d",
        to: "now",
      },
      limit: 20,
      items: [],
    });

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/grep?repo=everr-labs%2Feverr&pattern=panic&jobName=integration&stepNumber=5&excludeBranch=feature%2Fcurrent-issue&offset=9",
      ),
    });

    expect(response.status).toBe(200);
    expect(mockedGetGrepMatches).toHaveBeenCalledWith({
      data: {
        repo: "everr-labs/everr",
        pattern: "panic",
        jobName: "integration",
        stepNumber: "5",
        branch: undefined,
        excludeBranch: "feature/current-issue",
        limit: 20,
        offset: 9,
        timeRange: {
          from: "now-7d",
          to: "now",
        },
      },
    });
    expect(await response.json()).toEqual({
      repo: "everr-labs/everr",
      pattern: "panic",
      jobName: "integration",
      stepNumber: "5",
      branch: null,
      excludedBranch: "feature/current-issue",
      timeRange: {
        from: "now-30d",
        to: "now",
      },
      limit: 20,
      items: [],
    });
  });

  it("returns 400 when pattern is missing", async () => {
    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/grep?repo=everr-labs%2Feverr",
      ),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "Invalid query parameters. Required: repo, pattern. Optional: jobName and stepNumber together, branch, excludeBranch, from, to, limit, offset.",
    });
    expect(mockedGetGrepMatches).not.toHaveBeenCalled();
  });

  it("returns 400 when jobName is provided without stepNumber", async () => {
    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/grep?repo=everr-labs%2Feverr&pattern=panic&jobName=integration",
      ),
    });

    expect(response.status).toBe(400);
    expect(mockedGetGrepMatches).not.toHaveBeenCalled();
  });

  it("returns 400 when stepNumber is provided without jobName", async () => {
    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/grep?repo=everr-labs%2Feverr&pattern=panic&stepNumber=5",
      ),
    });

    expect(response.status).toBe(400);
    expect(mockedGetGrepMatches).not.toHaveBeenCalled();
  });

  it("returns 400 when branch and excludeBranch are both provided", async () => {
    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/grep?repo=everr-labs%2Feverr&pattern=panic&branch=main&excludeBranch=feature%2Fcurrent-issue",
      ),
    });

    expect(response.status).toBe(400);
    expect(mockedGetGrepMatches).not.toHaveBeenCalled();
  });

  it("returns 400 when the time range exceeds the maximum grep lookback", async () => {
    mockedGetGrepTimeRangeValidationError.mockReturnValue(
      "Invalid time range. Grep supports a maximum lookback of 30 days.",
    );

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/grep?repo=everr-labs%2Feverr&pattern=panic&from=now-31d&to=now",
      ),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid time range. Grep supports a maximum lookback of 30 days.",
    });
    expect(mockedGetGrepMatches).not.toHaveBeenCalled();
  });
});
