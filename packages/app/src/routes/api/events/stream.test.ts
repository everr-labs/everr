import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { NotifyPayload } from "#app/db/notify.ts";

vi.mock("#app/db/hub.ts", () => ({
  subscribeTenant: vi.fn(() => vi.fn()),
  subscribeTrace: vi.fn(() => vi.fn()),
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

import { subscribeTenant, subscribeTrace } from "#app/db/hub.ts";
import { Route } from "./stream";

const mockedSubscribeTenant = vi.mocked(subscribeTenant);
const mockedSubscribeTrace = vi.mocked(subscribeTrace);

const mockOrganization = { id: "org1" };

type GetHandler = (args: {
  request: Request;
  context: { organization: typeof mockOrganization };
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
  mockedSubscribeTenant.mockReturnValue(vi.fn());
  mockedSubscribeTrace.mockReturnValue(vi.fn());
});

describe("GET /api/events/stream", () => {
  it.each(["scope=invalid", "scope=trace", "scope=commit&key=abc"])(
    "returns 400 for %s (invalid scope or missing key)",
    async (query) => {
      const response = await getHandler()({
        request: new Request(`http://localhost/api/events/stream?${query}`),
        context: { organization: mockOrganization },
      });

      expect(response.status).toBe(400);
    },
  );

  it("subscribes to tenant topic for scope=tenant", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=tenant"),
      context: { organization: mockOrganization },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(mockedSubscribeTenant).toHaveBeenCalledWith("org1", expect.any(Function));
  });

  it("subscribes to trace topic for scope=trace", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/events/stream?scope=trace&key=abc123"),
      context: { organization: mockOrganization },
    });

    expect(response.status).toBe(200);
    expect(mockedSubscribeTrace).toHaveBeenCalledWith("org1", "abc123", expect.any(Function));
  });

  it.each([
    { query: "scope=tenant", subscribe: () => mockedSubscribeTenant },
    { query: "scope=trace&key=t1", subscribe: () => mockedSubscribeTrace },
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
      context: { organization: mockOrganization },
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
