import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { NotifyPayload } from "#app/db/notify.ts";

vi.mock("#app/db/hub.ts", () => ({
  subscribe: vi.fn(() => vi.fn()),
  subscribeTenant: vi.fn(() => vi.fn()),
  subscribeAuthor: vi.fn(() => vi.fn()),
}));

// @/lib/better-auth is mocked globally in test-setup.ts

vi.mock("#app/lib/sse.ts", () => ({
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

import { subscribe, subscribeAuthor, subscribeTenant } from "#app/db/hub.ts";
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
  it.each(["scope=invalid", "scope=trace", "scope=commit", "scope=author"])(
    "returns 400 for %s (invalid scope or missing key)",
    async (query) => {
      const response = await getHandler()({
        request: new Request(`http://localhost/api/events/stream?${query}`),
        context: { session: mockSession },
      });

      expect(response.status).toBe(400);
    },
  );

  it("subscribes to tenant topic for scope=tenant", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=tenant"),
      context: { session: mockSession },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(mockedSubscribeTenant).toHaveBeenCalledWith("org1", expect.any(Function));
  });

  it.each([
    ["trace", "abc123"],
    ["commit", "deadbeef"],
  ])("subscribes to the %s topic", async (scope, key) => {
    const response = await getHandler()({
      request: new Request(`http://localhost/api/events/stream?scope=${scope}&key=${key}`),
      context: { session: mockSession },
    });

    expect(response.status).toBe(200);
    expect(mockedSubscribe).toHaveBeenCalledWith(scope, "org1", key, expect.any(Function));
  });

  it("subscribes to author topic for scope=author", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=author&key=dev%40example.com"),
      context: { session: mockSession },
    });

    expect(response.status).toBe(200);
    expect(mockedSubscribeAuthor).toHaveBeenCalledWith(
      "org1",
      "dev@example.com",
      expect.any(Function),
    );
  });

  it.each([
    { query: "scope=tenant", subscribe: () => mockedSubscribeTenant },
    { query: "scope=trace&key=t1", subscribe: () => mockedSubscribe },
    { query: "scope=commit&key=abc", subscribe: () => mockedSubscribe },
    { query: "scope=author&key=dev%40example.com", subscribe: () => mockedSubscribeAuthor },
  ])("forwards each notification to the SSE stream for $query", async ({ query, subscribe }) => {
    const { createSSEStream } = await import("#app/lib/sse.ts");
    const mockSendEvent = vi.fn();
    vi.mocked(createSSEStream).mockReturnValueOnce({
      sendEvent: mockSendEvent,
      close: vi.fn(),
      response: vi.fn(() => new Response(null)),
    });

    await getHandler()({
      request: new Request(`http://localhost/api/events/stream?${query}`),
      context: { session: mockSession },
    });
    const onNotify = subscribe().mock.lastCall?.at(-1) as (payload: NotifyPayload) => void;

    const mockPayload: NotifyPayload = {
      tenantId: "42",
      traceId: "t1",
      runId: "r1",
      sha: "abc",
      repo: "org/repo",
      branch: "main",
      authorEmail: "dev@example.com",
      workflowName: "CI",
      name: "CI",
      type: "run",
      status: "completed",
      conclusion: "success",
      jobId: null,
    };
    onNotify(mockPayload);

    expect(mockSendEvent).toHaveBeenCalledWith(mockPayload);
  });
});
