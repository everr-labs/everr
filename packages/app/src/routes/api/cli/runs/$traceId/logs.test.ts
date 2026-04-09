import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/runs/server", () => ({
  getStepLogs: vi.fn(),
}));

vi.mock("@/lib/accessTokenAuthMiddleware", () => ({
  accessTokenAuthMiddleware: { options: {} },
}));

import { getStepLogs } from "@/data/runs/server";
import { Route } from "./logs";

const mockedGetStepLogs = vi.mocked(getStepLogs);

type GetHandler = (args: {
  params: { traceId: string };
  request: Request;
}) => Promise<Response>;

function getHandler(): GetHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { GET?: GetHandler } };
  };
  const handler = routeOptions.server?.handlers?.GET;
  if (!handler) throw new Error("Missing GET handler");
  return handler;
}

function makeRequest(params: Record<string, string>): Request {
  const url = new URL("http://localhost/api/cli/runs/trace-1/logs");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/cli/runs/:traceId/logs", () => {
  it("returns logs and offset in response body", async () => {
    mockedGetStepLogs.mockResolvedValue({
      logs: [{ timestamp: "2026-03-10T10:00:00.000Z", body: "hello" }],
      totalCount: 1,
      offset: 0,
    });

    const handler = getHandler();
    const response = await handler({
      params: { traceId: "trace-1" },
      request: makeRequest({ jobName: "build", stepNumber: "2" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      logs: [{ timestamp: "2026-03-10T10:00:00.000Z", body: "hello" }],
      offset: 0,
    });
  });

  it("passes egrep to getStepLogs when provided", async () => {
    mockedGetStepLogs.mockResolvedValue({
      logs: [],
      totalCount: 0,
      offset: 0,
    });

    const handler = getHandler();
    await handler({
      params: { traceId: "trace-1" },
      request: makeRequest({
        jobName: "build",
        stepNumber: "2",
        egrep: "Error",
      }),
    });

    expect(mockedGetStepLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ egrep: "Error" }),
      }),
    );
  });

  it("returns 400 for an invalid re2 pattern", async () => {
    const handler = getHandler();
    const response = await handler({
      params: { traceId: "trace-1" },
      request: makeRequest({
        jobName: "build",
        stepNumber: "2",
        egrep: "(?!lookahead)",
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/re2/i);
    expect(mockedGetStepLogs).not.toHaveBeenCalled();
  });

  it("returns 400 when ClickHouse throws a re2 error", async () => {
    mockedGetStepLogs.mockRejectedValue(
      new Error("DB::Exception: re2: Invalid regular expression"),
    );

    const handler = getHandler();
    const response = await handler({
      params: { traceId: "trace-1" },
      request: makeRequest({
        jobName: "build",
        stepNumber: "2",
        egrep: "Error",
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/re2/i);
  });

  it("returns 400 for missing required query params", async () => {
    const handler = getHandler();
    const response = await handler({
      params: { traceId: "trace-1" },
      request: makeRequest({ jobName: "build" }),
    });

    expect(response.status).toBe(400);
  });
});
