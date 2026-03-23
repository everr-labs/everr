import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/notify", () => ({
  tenantChannel: vi.fn((id: number) => `tenant_${id}`),
  traceChannel: vi.fn((id: string) => `trace_${id}`),
}));

vi.mock("@/db/subscribe", () => ({
  createSubscription: vi.fn(() => vi.fn()),
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

import { createSubscription } from "@/db/subscribe";
import {
  getAccessTokenSessionFromRequest,
  getWorkOSAuthSession,
} from "@/lib/auth";
import { Route } from "./subscribe";

const mockedCreateSubscription = vi.mocked(createSubscription);
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
  mockedCreateSubscription.mockReturnValue(vi.fn());
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

  it("returns SSE stream for scope=tenant with correct headers", async () => {
    mockedGetAccessToken.mockResolvedValue(mockSession);

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/events/subscribe?scope=tenant",
      ),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(mockedCreateSubscription).toHaveBeenCalledWith(
      "tenant_42",
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("returns SSE stream for scope=trace with correct channel", async () => {
    mockedGetAccessToken.mockResolvedValue(mockSession);

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/events/subscribe?scope=trace&traceId=abc123",
      ),
    });

    expect(response.status).toBe(200);
    expect(mockedCreateSubscription).toHaveBeenCalledWith(
      "trace_abc123",
      expect.any(Function),
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
