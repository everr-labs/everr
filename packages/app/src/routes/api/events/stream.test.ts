import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotifyPayload } from "@/db/notify";

vi.mock("@/db/hub", () => ({
  subscribe: vi.fn(() => vi.fn()),
  subscribeTenant: vi.fn(() => vi.fn()),
  subscribeAuthor: vi.fn(() => vi.fn()),
}));

// @/lib/better-auth is mocked globally in test-setup.ts

vi.mock("@/lib/sse", () => ({
  createSSEStream: vi.fn(() => ({
    sendEvent: vi.fn(),
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
  })),
}));

import { subscribe, subscribeAuthor, subscribeTenant } from "@/db/hub";
import { Route } from "./stream";

const mockedSubscribe = vi.mocked(subscribe);
const mockedSubscribeAuthor = vi.mocked(subscribeAuthor);
const mockedSubscribeTenant = vi.mocked(subscribeTenant);

const mockSession = {
  userId: "u1",
  organizationId: "org1",
};

type GetHandler = (args: {
  request: Request;
  context: { session: typeof mockSession };
}) => Promise<Response>;

function getHandler(): GetHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { GET?: GetHandler } };
  };
  const handler = routeOptions.server?.handlers?.GET;
  if (!handler) throw new Error("Missing GET handler");
  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSubscribe.mockReturnValue(vi.fn());
  mockedSubscribeTenant.mockReturnValue(vi.fn());
  mockedSubscribeAuthor.mockReturnValue(vi.fn());
});

describe("GET /api/events/stream", () => {
  it("returns 400 for invalid scope", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=invalid"),
      context: { session: mockSession },
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 when scope=trace but key is missing", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=trace"),
      context: { session: mockSession },
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 when scope=commit but key is missing", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=commit"),
      context: { session: mockSession },
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 when scope=author but key is missing", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=author"),
      context: { session: mockSession },
    });

    expect(response.status).toBe(400);
  });

  it("subscribes to tenant topic for scope=tenant", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=tenant"),
      context: { session: mockSession },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(mockedSubscribeTenant).toHaveBeenCalledWith(
      "org1",
      expect.any(Function),
    );
  });

  it("subscribes to trace topic for scope=trace", async () => {
    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/events/stream?scope=trace&key=abc123",
      ),
      context: { session: mockSession },
    });

    expect(response.status).toBe(200);
    expect(mockedSubscribe).toHaveBeenCalledWith(
      "trace",
      "org1",
      "abc123",
      expect.any(Function),
    );
  });

  it("subscribes to commit topic for scope=commit", async () => {
    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/events/stream?scope=commit&key=deadbeef",
      ),
      context: { session: mockSession },
    });

    expect(response.status).toBe(200);
    expect(mockedSubscribe).toHaveBeenCalledWith(
      "commit",
      "org1",
      "deadbeef",
      expect.any(Function),
    );
  });

  it("subscribes to author topic for scope=author", async () => {
    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/events/stream?scope=author&key=dev%40example.com",
      ),
      context: { session: mockSession },
    });

    expect(response.status).toBe(200);
    expect(mockedSubscribeAuthor).toHaveBeenCalledWith(
      "org1",
      "dev@example.com",
      expect.any(Function),
    );
  });

  it("forwards the payload directly to the SSE stream when a notification arrives", async () => {
    const { createSSEStream } = await import("@/lib/sse");
    const mockSendEvent = vi.fn();
    vi.mocked(createSSEStream).mockReturnValueOnce({
      sendEvent: mockSendEvent,
      close: vi.fn(),
      response: vi.fn(() => new Response(null)),
    });

    let capturedCallback: ((payload: NotifyPayload) => void) | undefined;
    mockedSubscribeTenant.mockImplementationOnce((_tenantId, cb) => {
      capturedCallback = cb;
      return vi.fn();
    });

    await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=tenant"),
      context: { session: mockSession },
    });

    const mockPayload: NotifyPayload = {
      tenantId: "42",
      traceId: "t1",
      runId: "r1",
      sha: "abc",
      repo: "org/repo",
      branch: "main",
      authorEmail: null,
      workflowName: "CI",
      name: "CI",
      type: "run",
      status: "completed",
      conclusion: "success",
      jobId: null,
    };
    capturedCallback?.(mockPayload);

    expect(mockSendEvent).toHaveBeenCalledWith(mockPayload);
  });

  it("forwards the payload for a keyed scope (scope=commit)", async () => {
    const { createSSEStream } = await import("@/lib/sse");
    const mockSendEvent = vi.fn();
    vi.mocked(createSSEStream).mockReturnValueOnce({
      sendEvent: mockSendEvent,
      close: vi.fn(),
      response: vi.fn(() => new Response(null)),
    });

    let capturedCallback: ((payload: NotifyPayload) => void) | undefined;
    mockedSubscribe.mockImplementationOnce((_scope, _tenantId, _key, cb) => {
      capturedCallback = cb;
      return vi.fn();
    });

    await getHandler()({
      request: new Request(
        "http://localhost/api/events/stream?scope=commit&key=deadbeef",
      ),
      context: { session: mockSession },
    });

    const mockPayload: NotifyPayload = {
      tenantId: "42",
      traceId: "t1",
      runId: "r1",
      sha: "deadbeef",
      repo: "org/repo",
      branch: "main",
      authorEmail: null,
      workflowName: "CI",
      name: "CI",
      type: "run",
      status: "completed",
      conclusion: "success",
      jobId: null,
    };
    capturedCallback?.(mockPayload);

    expect(mockSendEvent).toHaveBeenCalledWith(mockPayload);
  });
});
