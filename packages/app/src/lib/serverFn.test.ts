import { beforeEach, describe, expect, it, vi } from "vitest";

type FunctionMiddlewareHandler = (args: {
  request: Request;
  context?: Record<string, unknown>;
  next: (args?: unknown) => Promise<unknown>;
}) => Promise<unknown>;

const mocked = vi.hoisted(() => ({
  handler: null as FunctionMiddlewareHandler | null,
  middlewareDefinition: null as {
    options: { type: string };
    __handler: FunctionMiddlewareHandler;
  } | null,
  createServerFnMiddleware: vi.fn(),
  createServerFnResult: {},
  getRequest: vi.fn(),
  getSession: vi.fn(),
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
  mocked.getSession.mockReset();
});

async function loadModule() {
  function makeMiddleware(handlers: FunctionMiddlewareHandler[] = []) {
    return {
      middleware: (
        definitions: Array<{ __handler?: FunctionMiddlewareHandler }>,
      ) =>
        makeMiddleware([
          ...handlers,
          ...definitions
            .map((definition) => definition.__handler)
            .filter((handler): handler is FunctionMiddlewareHandler =>
              Boolean(handler),
            ),
        ]),
      server: (handler: FunctionMiddlewareHandler) => {
        const composed = handlers.reduceRight<FunctionMiddlewareHandler>(
          (nextHandler, middlewareHandler) =>
            async ({ request, context, next }) =>
              middlewareHandler({
                request,
                context,
                next: (args?: unknown) =>
                  nextHandler({
                    request,
                    context:
                      typeof args === "object" && args !== null
                        ? {
                            ...context,
                            ...((args as { context?: Record<string, unknown> })
                              .context ?? {}),
                          }
                        : context,
                    next,
                  }),
              }),
          handler,
        );

        const definition = {
          options: { type: "function" },
          __handler: composed,
        };
        mocked.handler = composed;
        mocked.middlewareDefinition = definition;
        return definition;
      },
    };
  }

  vi.doMock("@tanstack/react-start", () => ({
    createMiddleware: vi.fn(() => makeMiddleware()),
    createServerFn: vi.fn(() => ({
      middleware: mocked.createServerFnMiddleware,
    })),
  }));
  vi.doMock("@tanstack/react-start/server", () => ({
    getRequest: mocked.getRequest,
  }));
  vi.doMock("./auth.server", () => ({
    auth: {
      api: {
        getSession: mocked.getSession,
      },
    },
  }));

  return vi.importActual<typeof import("./serverFn")>("./serverFn");
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
  it("authenticates via better-auth session and populates context", async () => {
    await loadModule();
    const request = new Request("http://localhost/_server");
    const nextResult = new Response(null, { status: 204 });
    const next = vi.fn().mockResolvedValue(nextResult);
    mocked.getRequest.mockReturnValue(request);
    mocked.getSession.mockResolvedValue({
      user: { id: "user_123" },
      session: { id: "session_123", activeOrganizationId: "org_123" },
    });

    const response = await getHandler()({ request, next });

    expect(response).toBe(nextResult);
    expect(next).toHaveBeenCalledWith({
      context: {
        session: {
          user: { id: "user_123" },
          session: {
            id: "session_123",
            activeOrganizationId: "org_123",
          },
        },
        clickhouse: {
          query: expect.any(Function),
        },
      },
    });
  });

  it("throws when session is not available", async () => {
    await loadModule();
    const request = new Request("http://localhost/_server");
    const next = vi.fn();
    mocked.getRequest.mockReturnValue(request);
    mocked.getSession.mockResolvedValue(null);

    await expect(getHandler()({ request, next })).rejects.toThrow(
      "Unauthenticated",
    );

    expect(next).not.toHaveBeenCalled();
  });

  it("throws when no active organization", async () => {
    await loadModule();
    const request = new Request("http://localhost/_server");
    const next = vi.fn();
    mocked.getRequest.mockReturnValue(request);
    mocked.getSession.mockResolvedValue({
      user: { id: "user_123" },
      session: { id: "session_123", activeOrganizationId: null },
    });

    await expect(getHandler()({ request, next })).rejects.toThrow(
      "No active organization",
    );

    expect(next).not.toHaveBeenCalled();
  });
});
