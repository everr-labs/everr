import { beforeEach, describe, expect, it, vi } from "vitest";

type FunctionMiddlewareHandler = (args: {
  next: (args?: unknown) => Promise<unknown>;
}) => Promise<unknown>;

const mocked = vi.hoisted(() => ({
  handler: null as FunctionMiddlewareHandler | null,
  middlewareDefinition: { options: { type: "function" } },
  createServerFnMiddleware: vi.fn(),
  createServerFnResult: { authenticated: true },
  getRequest: vi.fn(),
  getAccessTokenSessionFromRequest: vi.fn(),
  getWorkOSAuthSession: vi.fn(),
  setRequestContextInStartContext: vi.fn(),
}));

function getHandler(): FunctionMiddlewareHandler {
  if (!mocked.handler) {
    throw new Error("Expected function middleware handler to be registered.");
  }

  return mocked.handler;
}

beforeEach(() => {
  vi.resetModules();
  mocked.handler = null;
  mocked.createServerFnMiddleware.mockReset();
  mocked.createServerFnMiddleware.mockReturnValue(mocked.createServerFnResult);
  mocked.getRequest.mockReset();
  mocked.getAccessTokenSessionFromRequest.mockReset();
  mocked.getWorkOSAuthSession.mockReset();
  mocked.setRequestContextInStartContext.mockReset();
});

async function loadModule() {
  vi.doMock("@tanstack/react-start", () => ({
    createMiddleware: vi.fn(() => ({
      server: (handler: FunctionMiddlewareHandler) => {
        mocked.handler = handler;
        return mocked.middlewareDefinition;
      },
    })),
    createServerFn: vi.fn(() => ({
      middleware: mocked.createServerFnMiddleware,
    })),
  }));
  vi.doMock("@tanstack/react-start/server", () => ({
    getRequest: mocked.getRequest,
  }));
  vi.doMock("@/lib/start-context", () => ({
    setRequestContextInStartContext: mocked.setRequestContextInStartContext,
  }));
  vi.doMock("./auth", () => ({
    getAccessTokenSessionFromRequest: mocked.getAccessTokenSessionFromRequest,
    getWorkOSAuthSession: mocked.getWorkOSAuthSession,
  }));

  return import("./serverFn");
}

describe("createAuthenticatedServerFn", () => {
  it("wires the auth middleware into createServerFn", async () => {
    const { createAuthenticatedServerFn } = await loadModule();

    expect(createAuthenticatedServerFn).toBe(mocked.createServerFnResult);
    expect(mocked.createServerFnMiddleware).toHaveBeenCalledWith([
      mocked.middlewareDefinition,
    ]);
  });
});

describe("authMiddleware", () => {
  it("prefers the access-token session when one is available", async () => {
    await loadModule();
    const session = {
      tenantId: 42,
      organizationId: "org_123",
      userId: "user_123",
      sessionId: undefined,
    };
    const request = new Request("http://localhost/_server");
    const nextResult = new Response(null, { status: 204 });
    const next = vi.fn().mockResolvedValue(nextResult);
    mocked.getRequest.mockReturnValue(request);
    mocked.getAccessTokenSessionFromRequest.mockResolvedValue(session);

    const response = await getHandler()({ next });

    expect(response).toBe(nextResult);
    expect(mocked.getAccessTokenSessionFromRequest).toHaveBeenCalledWith(
      request,
    );
    expect(mocked.getWorkOSAuthSession).not.toHaveBeenCalled();
    expect(mocked.setRequestContextInStartContext).toHaveBeenCalledWith(
      session,
    );
    expect(next).toHaveBeenCalledWith({
      context: {
        session,
      },
    });
  });

  it("falls back to the WorkOS session when there is no access token", async () => {
    await loadModule();
    const session = {
      tenantId: 77,
      organizationId: "org_456",
      userId: "user_456",
      sessionId: "session_456",
    };
    const nextResult = new Response(null, { status: 204 });
    const next = vi.fn().mockResolvedValue(nextResult);
    mocked.getRequest.mockReturnValue(new Request("http://localhost/_server"));
    mocked.getAccessTokenSessionFromRequest.mockResolvedValue(null);
    mocked.getWorkOSAuthSession.mockResolvedValue(session);

    const response = await getHandler()({ next });

    expect(response).toBe(nextResult);
    expect(mocked.getWorkOSAuthSession).toHaveBeenCalledTimes(1);
    expect(mocked.setRequestContextInStartContext).toHaveBeenCalledWith(
      session,
    );
    expect(next).toHaveBeenCalledWith({
      context: {
        session,
      },
    });
  });

  it("throws when neither access-token nor WorkOS auth is available", async () => {
    await loadModule();
    const next = vi.fn();
    mocked.getRequest.mockReturnValue(new Request("http://localhost/_server"));
    mocked.getAccessTokenSessionFromRequest.mockResolvedValue(null);
    mocked.getWorkOSAuthSession.mockResolvedValue(null);

    await expect(getHandler()({ next })).rejects.toThrow("Unauthenticated");

    expect(next).not.toHaveBeenCalled();
    expect(mocked.setRequestContextInStartContext).not.toHaveBeenCalled();
  });
});
