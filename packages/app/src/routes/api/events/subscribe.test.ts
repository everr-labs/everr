import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/hub", () => ({
  subscribe: vi.fn(() => vi.fn()),
  subscribeTenant: vi.fn(() => vi.fn()),
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

import { subscribe, subscribeTenant } from "@/db/hub";
import {
  getAccessTokenSessionFromRequest,
  getWorkOSAuthSession,
} from "@/lib/auth";
import { Route } from "./subscribe";

const mockedSubscribe = vi.mocked(subscribe);
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
});

describe("GET /api/events/subscribe", () => {
  it("returns 401 when not authenticated", async () => {
    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/events/subscribe?scope=tenant",
      ),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 400 for invalid scope", async () => {
    mockedGetAccessToken.mockResolvedValue(mockSession);

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/events/subscribe?scope=invalid",
      ),
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 when scope=trace but traceId is missing", async () => {
    mockedGetAccessToken.mockResolvedValue(mockSession);

    const response = await getHandler()({
      request: new Request("http://localhost/api/events/subscribe?scope=trace"),
    });

    expect(response.status).toBe(400);
  });

  it("subscribes to tenant topic for scope=tenant", async () => {
    mockedGetAccessToken.mockResolvedValue(mockSession);

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/events/subscribe?scope=tenant",
      ),
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
        "http://localhost/api/events/subscribe?scope=trace&traceId=abc123",
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

  it("falls back to WorkOS session when no Bearer token", async () => {
    mockedGetAccessToken.mockResolvedValue(null);
    mockedGetWorkOS.mockResolvedValue(mockSession);

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/events/subscribe?scope=tenant",
      ),
    });

    expect(response.status).toBe(200);
    expect(mockedGetWorkOS).toHaveBeenCalled();
  });
});
