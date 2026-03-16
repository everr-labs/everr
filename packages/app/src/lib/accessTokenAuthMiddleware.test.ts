import { beforeEach, describe, expect, it, vi } from "vitest";

type RequestMiddlewareHandler = (args: {
  next: (args?: unknown) => Promise<unknown>;
  request: Request;
}) => Promise<unknown>;

const mocked = vi.hoisted(() => ({
  handler: null as RequestMiddlewareHandler | null,
  getAccessTokenSessionFromRequest: vi.fn(),
  createAuthContext: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createMiddleware: vi.fn((options: unknown) => ({
    server: (handler: RequestMiddlewareHandler) => {
      mocked.handler = handler;
      return { options };
    },
  })),
}));

vi.mock("./auth", () => ({
  getAccessTokenSessionFromRequest: mocked.getAccessTokenSessionFromRequest,
}));

vi.mock("./auth-context", () => ({
  createAuthContext: mocked.createAuthContext,
}));

import { accessTokenAuthMiddleware } from "./accessTokenAuthMiddleware";

function getHandler(): RequestMiddlewareHandler {
  if (!mocked.handler) {
    throw new Error("Expected request middleware handler to be registered.");
  }

  return mocked.handler;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.createAuthContext.mockImplementation((session) => ({
    session,
    clickhouse: {
      query: vi.fn(),
    },
  }));
});

describe("accessTokenAuthMiddleware", () => {
  it("exports a request middleware", () => {
    expect(accessTokenAuthMiddleware).toEqual({
      options: { type: "request" },
    });
  });

  it("returns a 401 response when the request has no access-token session", async () => {
    mocked.getAccessTokenSessionFromRequest.mockResolvedValue(null);
    const next = vi.fn();

    const response = (await getHandler()({
      next,
      request: new Request("http://localhost/api/cli/runs"),
    })) as Response;

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "You need to be authenticated to use this API",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("stores the session in start context and forwards it to the next handler", async () => {
    const session = {
      tenantId: 42,
      organizationId: "org_123",
      userId: "user_123",
      sessionId: undefined,
    };
    const nextResult = new Response(null, { status: 204 });
    const next = vi.fn().mockResolvedValue(nextResult);
    const request = new Request("http://localhost/api/cli/runs");
    mocked.getAccessTokenSessionFromRequest.mockResolvedValue(session);

    const response = await getHandler()({ next, request });

    expect(response).toBe(nextResult);
    expect(mocked.getAccessTokenSessionFromRequest).toHaveBeenCalledWith(
      request,
    );
    expect(mocked.createAuthContext).toHaveBeenCalledWith(session);
    expect(next).toHaveBeenCalledWith({
      context: {
        session,
        clickhouse: {
          query: expect.any(Function),
        },
      },
    });
  });
});
