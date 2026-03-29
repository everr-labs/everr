import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/watch", () => ({
  getWatchStatus: vi.fn(),
}));

vi.mock("@/lib/accessTokenAuthMiddleware", () => ({
  accessTokenAuthMiddleware: {
    options: {},
  },
}));

vi.mock("@/db/hub", () => ({
  subscribe: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/sse", () => ({
  createSSEStream: vi.fn(() => {
    const events: object[] = [];
    return {
      sendEvent: vi.fn((data: object) => events.push(data)),
      close: vi.fn(),
      response: vi.fn(
        () =>
          new Response(null, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          }),
      ),
      _events: events,
    };
  }),
}));

import { getWatchStatus } from "@/data/watch";
import { subscribe } from "@/db/hub";
import { Route } from "./watch";

const mockedSubscribe = vi.mocked(subscribe);
const mockedGetWatchStatus = vi.mocked(getWatchStatus);

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
    throw new Error("Missing GET handler for watch route.");
  }

  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSubscribe.mockReturnValue(vi.fn());
});

describe("/api/cli/runs/watch — SSE streaming", () => {
  it("returns SSE stream with text/event-stream content type", async () => {
    mockedGetWatchStatus.mockResolvedValue({
      state: "running",
      active: [
        {
          traceId: "trace-42",
          runId: "42",
          workflowName: "CI",
          conclusion: null,
          startedAt: "2026-03-06T10:00:00.000Z",
          durationSeconds: null,
          expectedDurationSeconds: 60,
          activeJobs: ["test"],
        },
      ],
      completed: [],
    });

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/runs/watch?repo=org%2Frepo&branch=main&commit=abc123def456abc123def456abc123def456abc1",
      ),
      context: { session: { tenantId: 42 } },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(mockedGetWatchStatus).toHaveBeenCalledOnce();
    expect(mockedSubscribe).toHaveBeenCalledOnce();
  });

  it("subscribes to commit topic with tenantId:sha key", async () => {
    mockedGetWatchStatus.mockResolvedValue({
      state: "running",
      active: [],
      completed: [],
    });

    await getHandler()({
      request: new Request(
        "http://localhost/api/cli/runs/watch?repo=org%2Frepo&branch=main&commit=abc123def456abc123def456abc123def456abc1",
      ),
      context: { session: { tenantId: 42 } },
    });

    expect(mockedSubscribe).toHaveBeenCalledWith(
      "commit",
      "42:abc123def456abc123def456abc123def456abc1",
      expect.any(Function),
    );
  });

  it("disposes subscription when initial state is already completed", async () => {
    const unsubscribe = vi.fn();
    mockedSubscribe.mockReturnValue(unsubscribe);

    mockedGetWatchStatus.mockResolvedValue({
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
          expectedDurationSeconds: 58,
          activeJobs: [],
        },
      ],
    });

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/runs/watch?repo=org%2Frepo&branch=main&commit=abc123def456abc123def456abc123def456abc1",
      ),
      context: { session: { tenantId: 42 } },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(mockedSubscribe).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("requires repo and commit", async () => {
    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/runs/watch?repo=org%2Frepo",
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
        "Invalid query parameters for watch. Required: repo, commit. Optional: branch.",
    });
    expect(mockedGetWatchStatus).not.toHaveBeenCalled();
  });

  it("works without branch when commit is provided", async () => {
    mockedGetWatchStatus.mockResolvedValue({
      state: "running",
      active: [
        {
          traceId: "trace-42",
          runId: "42",
          workflowName: "CI",
          conclusion: null,
          startedAt: "2026-03-06T10:00:00.000Z",
          durationSeconds: null,
          expectedDurationSeconds: 60,
          activeJobs: ["test"],
        },
      ],
      completed: [],
    });

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/runs/watch?repo=org%2Frepo&commit=abc123def456abc123def456abc123def456abc1",
      ),
      context: { session: { tenantId: 42 } },
    });

    expect(response.status).toBe(200);
    expect(mockedGetWatchStatus).toHaveBeenCalledOnce();
  });
});
