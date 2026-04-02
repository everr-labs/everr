import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotifyPayload } from "@/db/notify";

vi.mock("@/db/hub", () => ({
  subscribe: vi.fn(() => vi.fn()),
  subscribeTenant: vi.fn(() => vi.fn()),
  subscribeAuthor: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/auth", () => ({
  getAccessTokenSessionFromRequest: vi.fn().mockResolvedValue(null),
  getWorkOSAuthSession: vi.fn().mockResolvedValue(null),
}));

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
import {
  getAccessTokenSessionFromRequest,
  getWorkOSAuthSession,
} from "@/lib/auth";
import { Route } from "./stream";

const mockedSubscribe = vi.mocked(subscribe);
const mockedSubscribeAuthor = vi.mocked(subscribeAuthor);
const mockedSubscribeTenant = vi.mocked(subscribeTenant);
const mockedGetAccessToken = vi.mocked(getAccessTokenSessionFromRequest);
const mockedGetWorkOS = vi.mocked(getWorkOSAuthSession);

const mockSession = {
  tenantId: 42,
  userId: "u1",
  organizationId: "org1",
  sessionId: undefined,
};

type GetHandler = (args: { request: Request }) => Promise<Response>;

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
  it("returns 401 when not authenticated", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=tenant"),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 400 for invalid scope", async () => {
    mockedGetAccessToken.mockResolvedValue(mockSession);

    const response = await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=invalid"),
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 when scope=trace but key is missing", async () => {
    mockedGetAccessToken.mockResolvedValue(mockSession);

    const response = await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=trace"),
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 when scope=commit but key is missing", async () => {
    mockedGetAccessToken.mockResolvedValue(mockSession);

    const response = await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=commit"),
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 when scope=author but key is missing", async () => {
    mockedGetAccessToken.mockResolvedValue(mockSession);

    const response = await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=author"),
    });

    expect(response.status).toBe(400);
  });

  it("subscribes to tenant topic for scope=tenant", async () => {
    mockedGetAccessToken.mockResolvedValue(mockSession);

    const response = await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=tenant"),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(mockedSubscribeTenant).toHaveBeenCalledWith(
      42,
      expect.any(Function),
    );
  });

  it("subscribes to trace topic for scope=trace", async () => {
    mockedGetAccessToken.mockResolvedValue(mockSession);

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/events/stream?scope=trace&key=abc123",
      ),
    });

    expect(response.status).toBe(200);
    expect(mockedSubscribe).toHaveBeenCalledWith(
      "trace",
      42,
      "abc123",
      expect.any(Function),
    );
  });

  it("subscribes to commit topic for scope=commit", async () => {
    mockedGetAccessToken.mockResolvedValue(mockSession);

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/events/stream?scope=commit&key=deadbeef",
      ),
    });

    expect(response.status).toBe(200);
    expect(mockedSubscribe).toHaveBeenCalledWith(
      "commit",
      42,
      "deadbeef",
      expect.any(Function),
    );
  });

  it("subscribes to author topic for scope=author", async () => {
    mockedGetAccessToken.mockResolvedValue(mockSession);

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/events/stream?scope=author&key=dev%40example.com",
      ),
    });

    expect(response.status).toBe(200);
    expect(mockedSubscribeAuthor).toHaveBeenCalledWith(
      42,
      "dev@example.com",
      expect.any(Function),
    );
  });

  it("falls back to WorkOS session when no Bearer token", async () => {
    mockedGetAccessToken.mockResolvedValue(null);
    mockedGetWorkOS.mockResolvedValue(mockSession);

    const response = await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=tenant"),
    });

    expect(response.status).toBe(200);
    expect(mockedGetWorkOS).toHaveBeenCalled();
  });

  it("forwards the payload directly to the SSE stream when a notification arrives", async () => {
    mockedGetAccessToken.mockResolvedValue(mockSession);
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
    });

    const mockPayload = {
      tenantId: 42,
      traceId: "t1",
      runId: "r1",
      sha: "abc",
      repo: "org/repo",
      branch: "main",
      authorEmail: null,
      workflowName: "CI",
      name: "CI",
      type: "run" as const,
      status: "completed",
      conclusion: "success",
      jobId: null,
    };
    capturedCallback?.(mockPayload);

    expect(mockSendEvent).toHaveBeenCalledWith(mockPayload);
  });

  it("forwards the payload for a keyed scope (scope=commit)", async () => {
    mockedGetAccessToken.mockResolvedValue(mockSession);
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
    });

    const mockPayload = {
      tenantId: 42,
      traceId: "t1",
      runId: "r1",
      sha: "deadbeef",
      repo: "org/repo",
      branch: "main",
      authorEmail: null,
      workflowName: "CI",
      name: "CI",
      type: "run" as const,
      status: "completed",
      conclusion: "success",
      jobId: null,
    };
    capturedCallback?.(mockPayload);

    expect(mockSendEvent).toHaveBeenCalledWith(mockPayload);
  });
});
